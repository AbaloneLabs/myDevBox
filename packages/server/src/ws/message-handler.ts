/**
 * WebSocket Message Handler
 *
 * Processes incoming client messages, runs the agent loop,
 * and broadcasts events back to connected clients.
 *
 * Based on pi's agent execution pattern and Plan 7 design.
 */

import type { WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '@mydevbox/shared'
import { connectionManager } from './connection.js'
import { sessionRegistry, buildSystemPrompt, getProvider } from '../agent/index.js'
import { getDefaultModelConfig } from '../agent/model-config.js'
import { createProjectTools, createDbTodoTools, createDbWikiTools } from '../agent/tools/index.js'
import type { AgentEvent, AgentLoopConfig, Message, ModelConfig } from '../agent/types.js'
import { db } from '../db/connection.js'
import { projects, chatMessages } from '../db/schema.js'
import { wikiService } from '../services/wiki-service.js'
import { eq } from 'drizzle-orm'
import { logger } from '../logger.js'

/**
 * Handle an incoming client message.
 */
export async function handleMessage(
  ws: WebSocket,
  projectId: string,
  message: ClientMessage,
): Promise<void> {
  switch (message.type) {
    case 'send_message':
      await handleSendMessage(ws, projectId, message.content)
      break

    case 'abort_agent':
      handleAbort(projectId)
      break

    case 'subscribe_file_changes':
      connectionManager.setFileChangeSubscription(ws, true)
      break

    case 'unsubscribe_file_changes':
      connectionManager.setFileChangeSubscription(ws, false)
      break

    case 'ping':
      connectionManager.send(ws, { type: 'pong' })
      break
  }
}

/**
 * Send an error message to a single client.
 */
export function sendError(ws: WebSocket, message: string): void {
  connectionManager.send(ws, { type: 'error', message })
}

// ============ Agent Execution ============

async function handleSendMessage(
  ws: WebSocket,
  projectId: string,
  content: string,
): Promise<void> {
  try {
    // 1. Load project info
    const [projectRow] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
    if (!projectRow) {
      sendError(ws, 'Project not found')
      return
    }

    // 2. 서버-레벨 기본 프로바이더 자격증명 로드
    const modelConfig = await getDefaultModelConfig()
    if (!modelConfig) {
      sendError(ws, 'LLM 프로바이더가 설정되지 않았습니다. 설정에서 프로바이더를 추가하세요.')
      return
    }

    // 3. 사용자 메시지 DB 저장
    await db.insert(chatMessages).values({
      projectId,
      role: 'user',
      content,
    })

    // 5. Create tools
    const fileTools = createProjectTools(projectRow.path)
    const dbTodoTools = createDbTodoTools(projectId)
    const dbWikiTools = createDbWikiTools(projectId)
    // Replace in-memory todo tools with DB-backed ones
    const tools = [
      ...fileTools.filter(t => !['todo_write', 'todo_read', 'plan_create'].includes(t.name)),
      ...dbTodoTools,
      ...dbWikiTools,
    ]

    // 6. Build system prompt (with wiki preamble — index head + recent log)
    const wikiPreamble = await wikiService.buildPreamble(projectId, { indexLines: 40, logEntries: 10 })
    const systemPrompt = buildSystemPrompt({
      projectName: projectRow.name,
      projectPath: projectRow.path,
      tools,
      wikiPreamble,
    })

    // 7. Load message history from DB for context
    const historyRows = await db.select().from(chatMessages).where(eq(chatMessages.projectId, projectId))
    historyRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    const initialMessages: Message[] = historyRows
      .filter(r => r.role === 'user' || r.role === 'agent')
      .map(r => ({
        id: r.id,
        role: r.role === 'agent' ? 'assistant' : 'user',
        content: [{ type: 'text' as const, text: r.content }],
        timestamp: r.createdAt.getTime(),
      }))

    // 8. Get or create session
    const session = sessionRegistry.getOrCreate(
      projectId,
      modelConfig,
      tools,
      systemPrompt,
      initialMessages,
    )

    // 9. Check if already running
    if (session.isStreaming) {
      sendError(ws, 'Agent is already running. Please wait or abort the current task.')
      return
    }

    // 10. Get LLM provider
    const llmProvider = getProvider(modelConfig)

    // 11. Agent loop config
    const loopConfig: AgentLoopConfig = {
      model: modelConfig,
      maxTurns: 50,
      toolExecution: 'parallel',
    }

    // 12. Create event emitter that broadcasts to all project connections
    const emit = createEventEmitter(projectId)

    // 13. Run the agent
    const newMessages = await session.run(content, llmProvider, loopConfig, emit)

    // 14. Save assistant response to DB
    const lastMessage = newMessages[newMessages.length - 1]
    if (lastMessage && lastMessage.role === 'assistant') {
      const textContent = lastMessage.content
        .filter(c => c.type === 'text')
        .map(c => (c as { text: string }).text)
        .join('')

      if (textContent) {
        await db.insert(chatMessages).values({
          projectId,
          role: 'agent',
          content: textContent,
        })
      }
    }

    // 15. Broadcast todo updates after agent run
    await broadcastTodoUpdate(projectId)

  } catch (e) {
    logger.error({ err: e, projectId }, 'Agent execution error')
    connectionManager.broadcast(projectId, {
      type: 'error',
      message: e instanceof Error ? e.message : 'Agent execution failed',
    })
  }
}

function handleAbort(projectId: string): void {
  const session = sessionRegistry.get(projectId)
  if (session && session.isStreaming) {
    session.abort()
  }
}

// ============ Event Emitter ============

function createEventEmitter(projectId: string) {
  return async (event: AgentEvent): Promise<void> => {
    const message: ServerMessage = {
      type: 'agent_event',
      event: {
        ...event,
        timestamp: Date.now(),
      },
    }
    connectionManager.broadcast(projectId, message)
  }
}

// ============ Todo Broadcast ============

async function broadcastTodoUpdate(projectId: string): Promise<void> {
  // Import tasks table and query
  const { tasks } = await import('../db/schema.js')
  const taskRows = await db.select().from(tasks).where(eq(tasks.projectId, projectId))

  const todos = taskRows.map(t => ({
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    description: t.description ?? undefined,
    status: (t.status ?? 'pending') as 'pending' | 'in_progress' | 'completed',
    priority: (t.priority ?? 'medium') as 'low' | 'medium' | 'high',
    createdAt: t.createdAt.toISOString(),
  }))

  connectionManager.broadcast(projectId, {
    type: 'todo_updated',
    todos,
  })
}
