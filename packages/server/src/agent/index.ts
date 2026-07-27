/**
 * Agent Engine Module Exports
 */

// Types
export type {
  ContentBlock,
  TextContent,
  ToolCallContent,
  ToolResultContent,
  Message,
  MessageRole,
  ToolDefinition,
  ToolResult,
  AgentTool,
  ModelConfig,
  AgentContext,
  AgentEvent,
  AgentEventSink,
  AgentLoopConfig,
  BeforeToolCallContext,
  AfterToolCallContext,
  ShouldStopContext,
} from './types.js'

// LLM Providers
export type { LLMProvider, LLMMessage, StreamEvent } from './llm/provider.js'
export { convertToLLMMessages } from './llm/provider.js'
export { AnthropicProvider } from './llm/anthropic.js'
export { OpenAIProvider } from './llm/openai.js'

// Core
export { runAgentLoop } from './loop.js'
export { AgentSession, sessionRegistry } from './session.js'
export { buildSystemPrompt } from './system-prompt.js'
export type { SystemPromptOptions } from './system-prompt.js'
export { ContextManager, contextManager } from './context-manager.js'

// Models
export { AVAILABLE_MODELS, getModelsByProvider, findModel } from './models.js'

// Imports for getProvider helper
import type { ModelConfig } from './types.js'
import type { LLMProvider } from './llm/provider.js'
import { AnthropicProvider } from './llm/anthropic.js'
import { OpenAIProvider } from './llm/openai.js'

/**
 * Get the appropriate LLM provider for a model config.
 */
export function getProvider(modelConfig: ModelConfig): LLMProvider {
  switch (modelConfig.provider) {
    case 'anthropic':
      return new AnthropicProvider()
    case 'openai':
      return new OpenAIProvider()
    default:
      throw new Error(`Unknown provider: ${modelConfig.provider}`)
  }
}
