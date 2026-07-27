/**
 * Agent Session Manager
 *
 * Manages agent sessions per project. Each project has one active session
 * that maintains conversation state, abort capability, and tool registry.
 *
 * Based on pi's agent.ts (opensource/pi/packages/agent/src/agent.ts)
 */

import type {
  AgentContext,
  AgentEvent,
  AgentEventSink,
  AgentLoopConfig,
  AgentTool,
  Message,
  ModelConfig,
} from './types.js'
import type { LLMProvider } from './llm/provider.js'
import { runAgentLoop } from './loop.js'
import { contextManager } from './context-manager.js'

export class AgentSession {
  private context: AgentContext
  private abortController: AbortController | null = null
  private isRunning = false
  private projectId: string

  constructor(
    projectId: string,
    model: ModelConfig,
    tools: AgentTool[],
    systemPrompt: string,
    initialMessages?: Message[],
  ) {
    this.projectId = projectId
    this.context = {
      systemPrompt,
      messages: initialMessages ?? [],
      tools,
      model,
    }
  }

  /**
   * Run the agent with a user prompt.
   * Events are emitted for UI updates.
   */
  async run(
    prompt: string,
    provider: LLMProvider,
    config: AgentLoopConfig,
    emit: AgentEventSink,
  ): Promise<Message[]> {
    if (this.isRunning) {
      throw new Error('Agent session is already running')
    }

    this.abortController = new AbortController()
    this.isRunning = true

    try {
      // Compact context if needed before running
      const maxTokens = this.context.model.maxTokens ?? 8192
      if (contextManager.shouldCompact(this.context.messages, maxTokens)) {
        this.context.messages = contextManager.compact(this.context.messages, maxTokens)
      }

      return await runAgentLoop(
        prompt,
        this.context,
        config,
        provider,
        emit,
        this.abortController.signal,
      )
    } finally {
      this.isRunning = false
      this.abortController = null
    }
  }

  /**
   * Abort the current run.
   */
  abort(): void {
    this.abortController?.abort()
  }

  get isStreaming(): boolean {
    return this.isRunning
  }

  getMessages(): Message[] {
    return [...this.context.messages]
  }

  /**
   * Update the model configuration.
   */
  updateModel(model: ModelConfig): void {
    this.context.model = model
  }

  /**
   * Update the available tools.
   */
  updateTools(tools: AgentTool[]): void {
    this.context.tools = tools
  }

  /**
   * Update the system prompt.
   */
  updateSystemPrompt(systemPrompt: string): void {
    this.context.systemPrompt = systemPrompt
  }

  /**
   * Clear all messages (start fresh).
   */
  clearMessages(): void {
    this.context.messages = []
  }
}

/**
 * Session registry - manages sessions by project ID.
 */
class SessionRegistry {
  private sessions = new Map<string, AgentSession>()

  getOrCreate(
    projectId: string,
    model: ModelConfig,
    tools: AgentTool[],
    systemPrompt: string,
    initialMessages?: Message[],
  ): AgentSession {
    let session = this.sessions.get(projectId)
    if (!session) {
      session = new AgentSession(projectId, model, tools, systemPrompt, initialMessages)
      this.sessions.set(projectId, session)
    } else {
      // Update model/tools/prompt if changed
      session.updateModel(model)
      session.updateTools(tools)
      session.updateSystemPrompt(systemPrompt)
    }
    return session
  }

  get(projectId: string): AgentSession | undefined {
    return this.sessions.get(projectId)
  }

  delete(projectId: string): void {
    const session = this.sessions.get(projectId)
    if (session) {
      session.abort()
      this.sessions.delete(projectId)
    }
  }

  clear(): void {
    for (const session of this.sessions.values()) {
      session.abort()
    }
    this.sessions.clear()
  }
}

export const sessionRegistry = new SessionRegistry()
