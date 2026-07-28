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
import { PROVIDER_BY_ID } from './llm/registry.js'

/**
 * Get the appropriate LLM provider for a model config.
 * Routes by the provider descriptor's apiShape (registry.ts), not a string switch.
 * 새 프로바이더는 descriptor 추가만으로 라우팅에 편입된다.
 */
export function getProvider(modelConfig: ModelConfig): LLMProvider {
  const descriptor = PROVIDER_BY_ID[modelConfig.provider]
  if (!descriptor) {
    throw new Error(`Unknown provider: ${modelConfig.provider}`)
  }
  switch (descriptor.apiShape) {
    case 'anthropic-messages':
      return new AnthropicProvider()
    case 'openai-completions':
    case 'openai-responses': // Phase 4 전까지 openai-completions 어댑터로 처리
    case 'ollama-chat': // openai-completions 호환
      return new OpenAIProvider()
    default:
      throw new Error(
        `Provider "${modelConfig.provider}" (api shape "${descriptor.apiShape}") has no adapter yet`,
      )
  }
}
