/**
 * LLM Provider Interface
 *
 * Abstraction over OpenAI/Anthropic APIs.
 * Based on pi's stream function pattern (opensource/pi/packages/ai/src/types.ts)
 */

import type { ModelConfig, ToolDefinition } from '../types.js'

// ============ Stream Events ============

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argumentsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string }

// ============ LLM Message Format (provider-agnostic) ============

export interface LLMTextPart {
  type: 'text'
  text: string
}

export interface LLMToolCallPart {
  type: 'tool_call'
  id: string
  name: string
  arguments: string        // JSON string (accumulated deltas)
}

export interface LLMToolResultPart {
  type: 'tool_result'
  toolCallId: string
  content: string
  isError?: boolean
}

export type LLMContentPart = LLMTextPart | LLMToolCallPart | LLMToolResultPart

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: LLMContentPart[]
}

// ============ Provider Interface ============

export interface LLMProvider {
  /**
   * Stream a completion from the LLM.
   * Yields StreamEvents for text deltas, tool calls, and completion.
   */
  stream(
    model: ModelConfig,
    systemPrompt: string,
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent>
}

// ============ Message Conversion ============

/**
 * Convert internal Message[] to provider-agnostic LLMMessage[].
 * This is the boundary where AgentMessage[] → LLM messages.
 */
export function convertToLLMMessages(
  messages: { role: string; content: any[] }[],
): LLMMessage[] {
  const result: LLMMessage[] = []

  for (const msg of messages) {
    const parts: LLMContentPart[] = []

    for (const block of msg.content) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text })
      } else if (block.type === 'tool_call') {
        parts.push({
          type: 'tool_call',
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.arguments),
        })
      } else if (block.type === 'tool_result') {
        const text = block.content.map((c: any) => c.text).join('\n')
        parts.push({
          type: 'tool_result',
          toolCallId: block.toolCallId,
          content: text,
          isError: block.isError,
        })
      }
    }

    if (parts.length > 0) {
      result.push({ role: msg.role as LLMMessage['role'], content: parts })
    }
  }

  return result
}
