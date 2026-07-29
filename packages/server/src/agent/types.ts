/**
 * Agent Engine Type Definitions
 *
 * Based on pi's agent types (opensource/pi/packages/agent/src/types.ts)
 * Adapted for MyDevBox's TypeScript backend.
 */

// ============ Content Blocks ============

export interface TextContent {
  type: 'text'
  text: string
}

export interface ToolCallContent {
  type: 'tool_call'
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResultContent {
  type: 'tool_result'
  toolCallId: string
  toolName: string
  content: TextContent[]
  isError: boolean
}

export type ContentBlock = TextContent | ToolCallContent | ToolResultContent

// ============ Messages ============

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface Message {
  id: string
  role: MessageRole
  content: ContentBlock[]
  timestamp: number
  model?: string
  stopReason?: 'stop' | 'tool_use' | 'length' | 'error' | 'aborted'
}

// ============ Tools ============

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>   // JSON Schema
  executionMode?: 'sequential' | 'parallel'
  concurrency?: 'shared' | 'exclusive'
}

export interface ToolResult {
  content: TextContent[]
  details?: unknown
  isError?: boolean
  terminate?: boolean
}

export interface AgentTool extends ToolDefinition {
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (partial: ToolResult) => void,
  ) => Promise<ToolResult>
}

// ============ Model Configuration ============

export interface ModelConfig {
  provider: string
  model: string
  temperature?: number
  maxTokens?: number
  apiKey: string
  baseUrl?: string
  extraHeaders?: Record<string, string>
  authMode?: 'apikey' | 'bearer'
}

// ============ Agent Context ============

export interface AgentContext {
  systemPrompt: string
  messages: Message[]
  tools: AgentTool[]
  model: ModelConfig
}

// ============ Agent Events ============

export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: Message[] }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: Message; toolResults: Message[] }
  | { type: 'message_start'; message: Message }
  | { type: 'message_update'; message: Message; delta: string }
  | { type: 'message_end'; message: Message }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: ToolResult; isError: boolean }
  | { type: 'error'; message: string }

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void

// ============ Loop Hooks ============

export interface BeforeToolCallContext {
  assistantMessage: Message
  toolCallId: string
  toolName: string
  args: unknown
  context: AgentContext
}

export interface AfterToolCallContext {
  assistantMessage: Message
  toolCallId: string
  toolName: string
  args: unknown
  result: ToolResult
  isError: boolean
  context: AgentContext
}

export interface ShouldStopContext {
  message: Message
  toolResults: Message[]
  context: AgentContext
  newMessages: Message[]
}

// ============ Loop Configuration ============

export interface AgentLoopConfig {
  model: ModelConfig
  maxTurns?: number
  toolExecution?: 'sequential' | 'parallel'
  beforeToolCall?: (ctx: BeforeToolCallContext) => Promise<{ block?: boolean; reason?: string } | void>
  afterToolCall?: (ctx: AfterToolCallContext) => Promise<Partial<ToolResult> | void>
  shouldStopAfterTurn?: (ctx: ShouldStopContext) => boolean | Promise<boolean>
  /** 02-E: 매 턴 후 어드바이저(2nd 모델) 검토. note 반환 시 에이전트에 주입. */
  advisorCheck?: (ctx: { lastAssistantText: string }) => Promise<{ severity: 'nit' | 'concern' | 'blocker'; text: string } | void>
  /** 02-F: 스트리밍 중 룰 매칭(TTSR). abort 반환 시 스트림 중단 + 룰 주입 후 재시도. */
  streamRuleCheck?: (delta: string, fullText: string) => { abort: true; rule: string } | void
}
