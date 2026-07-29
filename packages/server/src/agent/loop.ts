/**
 * Agent Loop
 *
 * The core agent loop that processes user prompts, streams LLM responses,
 * executes tool calls, and continues until the LLM stops requesting tools.
 *
 * Based on pi's agent-loop.ts (opensource/pi/packages/agent/src/agent-loop.ts)
 */

import type {
  AgentContext,
  AgentEvent,
  AgentEventSink,
  AgentLoopConfig,
  Message,
  TextContent,
  ToolCallContent,
  ToolResult,
  ToolResultContent,
} from './types.js'
import type { LLMProvider, StreamEvent } from './llm/provider.js'
import { convertToLLMMessages } from './llm/provider.js'

/**
 * Run the agent loop with a user prompt.
 * Emits events for UI updates and returns the new messages.
 */
export async function runAgentLoop(
  prompt: string,
  context: AgentContext,
  config: AgentLoopConfig,
  provider: LLMProvider,
  emit: AgentEventSink,
  signal?: AbortSignal,
): Promise<Message[]> {
  const newMessages: Message[] = []

  // 1. Create and add user message
  const userMessage: Message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: prompt } as TextContent],
    timestamp: Date.now(),
  }
  context.messages.push(userMessage)
  newMessages.push(userMessage)

  await emit({ type: 'agent_start' })

  let turnCount = 0
  const maxTurns = config.maxTurns ?? 50

  // 2. Main loop
  while (turnCount < maxTurns) {
    if (signal?.aborted) {
      await emit({ type: 'agent_end', messages: newMessages })
      return newMessages
    }

    await emit({ type: 'turn_start' })
    turnCount++

    // 3. Stream assistant response
    const assistantMessage = await streamAssistantResponse(
      context, config, provider, signal, emit,
    )
    context.messages.push(assistantMessage)
    newMessages.push(assistantMessage)

    // 4. Check for errors/aborts
    if (assistantMessage.stopReason === 'error' || assistantMessage.stopReason === 'aborted') {
      await emit({ type: 'turn_end', message: assistantMessage, toolResults: [] })
      await emit({ type: 'agent_end', messages: newMessages })
      return newMessages
    }

    // 5. Extract tool calls
    const toolCalls = assistantMessage.content.filter(
      (c): c is ToolCallContent => c.type === 'tool_call',
    )

    if (toolCalls.length === 0) {
      // No tool calls → done
      await emit({ type: 'turn_end', message: assistantMessage, toolResults: [] })
      await emit({ type: 'agent_end', messages: newMessages })
      return newMessages
    }

    // 6. Execute tool calls
    const toolResults = await executeToolCalls(
      context, assistantMessage, config, signal, emit,
    )

    // 7. Add tool results to context
    for (const result of toolResults) {
      context.messages.push(result)
      newMessages.push(result)
    }

    await emit({ type: 'turn_end', message: assistantMessage, toolResults })

    // 02-E: advisor check — 매 턴 후 검토. note 반환 시 다음 턴에 주입.
    if (config.advisorCheck) {
      const lastText = assistantMessage.content.find((c) => c.type === 'text' as const)?.text ?? ''
      try {
        const note = await config.advisorCheck({ lastAssistantText: lastText })
        if (note && note.severity !== 'nit') {
          // concern/blocker → 다음 턴에 시스템 메시지로 주입
          context.messages.push({
            id: `advisor-${Date.now()}`,
            role: 'user',
            content: [{ type: 'text' as const, text: `[Advisor ${note.severity}]: ${note.text}` }],
            timestamp: Date.now(),
          })
        }
      } catch {
        // advisor 실패 시 무시 — 에이전트 루프에 영향 없음
      }
    }

    // 8. shouldStopAfterTurn check
    if (await config.shouldStopAfterTurn?.({ message: assistantMessage, toolResults, context, newMessages })) {
      await emit({ type: 'agent_end', messages: newMessages })
      return newMessages
    }
  }

  // Max turns reached
  await emit({ type: 'error', message: `Max turns (${maxTurns}) reached` })
  await emit({ type: 'agent_end', messages: newMessages })
  return newMessages
}

// ============ Assistant Response Streaming ============

async function streamAssistantResponse(
  context: AgentContext,
  config: AgentLoopConfig,
  provider: LLMProvider,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<Message> {
  // Convert messages to LLM format
  const llmMessages = convertToLLMMessages(context.messages)
  const toolDefs = context.tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    executionMode: t.executionMode,
  }))

  // Start building assistant message
  const messageId = crypto.randomUUID()
  let textContent = ''
  const toolCalls: ToolCallContent[] = []
  const toolCallArgBuffers = new Map<string, string>()

  const partialMessage: Message = {
    id: messageId,
    role: 'assistant',
    content: [],
    timestamp: Date.now(),
    model: config.model.model,
  }

  await emit({ type: 'message_start', message: { ...partialMessage } })

  // Stream from LLM
  let stopReason: Message['stopReason'] = 'stop'

  for await (const event of provider.stream(
    config.model,
    context.systemPrompt,
    llmMessages,
    toolDefs,
    signal,
  )) {
    switch (event.type) {
      case 'text_delta':
        textContent += event.text
        partialMessage.content = [{ type: 'text', text: textContent }]
        await emit({ type: 'message_update', message: { ...partialMessage }, delta: event.text })
        break

      case 'tool_call_start':
        toolCallArgBuffers.set(event.id, '')
        // Add placeholder tool call
        toolCalls.push({
          type: 'tool_call',
          id: event.id,
          name: event.name,
          arguments: {},
        })
        break

      case 'tool_call_delta': {
        const buf = toolCallArgBuffers.get(event.id) ?? ''
        const updated = buf + event.argumentsDelta
        toolCallArgBuffers.set(event.id, updated)
        break
      }

      case 'tool_call_end': {
        // Parse accumulated arguments
        const tc = toolCalls.find(t => t.id === event.id)
        if (tc) {
          const raw = toolCallArgBuffers.get(event.id) ?? '{}'
          try {
            tc.arguments = JSON.parse(raw)
          } catch {
            tc.arguments = {}
          }
        }
        break
      }

      case 'done':
        stopReason = mapStopReason(event.stopReason)
        break

      case 'error':
        stopReason = 'error'
        textContent += `\n[Error: ${event.message}]`
        break
    }
  }

  // Build final message content
  const finalContent: Message['content'] = []
  if (textContent) {
    finalContent.push({ type: 'text', text: textContent })
  }
  for (const tc of toolCalls) {
    finalContent.push(tc)
  }

  // If no content at all, add empty text
  if (finalContent.length === 0) {
    finalContent.push({ type: 'text', text: '' })
  }

  const finalMessage: Message = {
    ...partialMessage,
    content: finalContent,
    stopReason,
  }

  await emit({ type: 'message_end', message: finalMessage })
  return finalMessage
}

function mapStopReason(reason: string): Message['stopReason'] {
  switch (reason) {
    case 'tool_use':
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'length'
    case 'aborted':
      return 'aborted'
    case 'error':
      return 'error'
    default:
      return 'stop'
  }
}

// ============ Tool Execution ============

async function executeToolCalls(
  context: AgentContext,
  assistantMessage: Message,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<Message[]> {
  const toolCalls = assistantMessage.content.filter(
    (c): c is ToolCallContent => c.type === 'tool_call',
  )

  // 전역 sequential 강제(기존 호환) 아니면 shared/exclusive 혼합 스케줄 (→ 02-A).
  if (config.toolExecution === 'sequential') {
    return executeSequential(context, toolCalls, config, signal, emit)
  }
  return executeConcurrent(context, toolCalls, config, signal, emit)
}

async function executeSequential(
  context: AgentContext,
  toolCalls: ToolCallContent[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<Message[]> {
  const results: Message[] = []

  for (const tc of toolCalls) {
    if (signal?.aborted) break

    const result = await executeSingleTool(context, tc, config, signal, emit)
    results.push(result)
  }

  return results
}

/**
 * shared/exclusive 혼합 스케줄 (omp 패턴, → 02-A).
 * shared(읽기/검색)는 서로 병렬, exclusive(쓰기/실행)는 직전 exclusive + 대기 중 shared가
 * 모두 끝난 뒤 단독 실행되고 다음 exclusive의 기준이 된다.
 */
async function executeConcurrent(
  context: AgentContext,
  toolCalls: ToolCallContent[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<Message[]> {
  const results: (Message | undefined)[] = new Array(toolCalls.length)
  let lastExclusive: Promise<void> = Promise.resolve()
  let sharedTasks: Promise<void>[] = []
  const all: Promise<void>[] = []

  for (let i = 0; i < toolCalls.length; i++) {
    const idx = i
    const tc = toolCalls[idx]
    const tool = context.tools.find((t) => t.name === tc.name)
    const exclusive = tool?.concurrency === 'exclusive' || tool?.executionMode === 'sequential'

    const run = async (): Promise<void> => {
      if (signal?.aborted) return
      results[idx] = await executeSingleTool(context, tc, config, signal, emit)
    }

    if (exclusive) {
      // 직전 exclusive + 이 그룹의 shared들이 끝난 뒤 단독 실행. pendingShared를 스냅샷.
      const pendingShared = sharedTasks
      const task = lastExclusive.then(() => Promise.all(pendingShared)).then(run)
      lastExclusive = task
      sharedTasks = []
      all.push(task)
    } else {
      // 직전 exclusive가 끝난 뒤 병렬 그룹으로 실행.
      const task = lastExclusive.then(run)
      sharedTasks.push(task)
      all.push(task)
    }
  }
  await Promise.all(all)
  return results.filter((m): m is Message => m !== undefined)
}

async function executeSingleTool(
  context: AgentContext,
  toolCall: ToolCallContent,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<Message> {
  const tool = context.tools.find(t => t.name === toolCall.name)

  await emit({
    type: 'tool_execution_start',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args: toolCall.arguments,
  })

  // Tool not found
  if (!tool) {
    const errorResult: ToolResult = {
      content: [{ type: 'text', text: `Tool not found: ${toolCall.name}` }],
      isError: true,
    }
    await emit({
      type: 'tool_execution_end',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: errorResult,
      isError: true,
    })
    return buildToolResultMessage(toolCall, errorResult)
  }

  // beforeToolCall hook
  if (config.beforeToolCall) {
    const before = await config.beforeToolCall({
      assistantMessage: { id: '', role: 'assistant', content: [], timestamp: 0 },
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
      context,
    })
    if (before?.block) {
      const blocked: ToolResult = {
        content: [{ type: 'text', text: before.reason ?? 'Tool execution blocked' }],
        isError: true,
      }
      await emit({
        type: 'tool_execution_end',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: blocked,
        isError: true,
      })
      return buildToolResultMessage(toolCall, blocked)
    }
  }

  // Execute
  let result: ToolResult
  let isError = false

  try {
    result = await tool.execute(toolCall.id, toolCall.arguments, signal, (partial) => {
      void emit({
        type: 'tool_execution_update',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        partialResult: partial,
      })
    })
  } catch (e) {
    result = {
      content: [{ type: 'text', text: (e as Error).message }],
      isError: true,
    }
    isError = true
  }

  // afterToolCall hook
  if (config.afterToolCall) {
    try {
      const after = await config.afterToolCall({
        assistantMessage: { id: '', role: 'assistant', content: [], timestamp: 0 },
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.arguments,
        result,
        isError,
        context,
      })
      if (after) {
        result = {
          content: after.content ?? result.content,
          details: after.details ?? result.details,
          isError: after.isError ?? result.isError,
          terminate: after.terminate ?? result.terminate,
        }
        isError = after.isError ?? isError
      }
    } catch (e) {
      result = {
        content: [{ type: 'text', text: (e as Error).message }],
        isError: true,
      }
      isError = true
    }
  }

  await emit({
    type: 'tool_execution_end',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    result,
    isError,
  })

  return buildToolResultMessage(toolCall, result)
}

function buildToolResultMessage(
  toolCall: ToolCallContent,
  result: ToolResult,
): Message {
  const content: ToolResultContent[] = [{
    type: 'tool_result',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: result.content as TextContent[],
    isError: result.isError ?? false,
  }]

  return {
    id: crypto.randomUUID(),
    role: 'tool',
    content,
    timestamp: Date.now(),
  }
}
