/**
 * Anthropic LLM Provider
 *
 * Uses @anthropic-ai/sdk for streaming with tool use support.
 * Based on pi's anthropic implementation (opensource/pi/packages/ai/src/api/anthropic-messages.ts)
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  ModelConfig,
  ToolDefinition,
} from '../types.js'
import type {
  LLMProvider,
  LLMMessage,
  LLMContentPart,
  StreamEvent,
} from './provider.js'

export class AnthropicProvider implements LLMProvider {
  async *stream(
    model: ModelConfig,
    systemPrompt: string,
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    // OAuth 토큰이면 Bearer(authToken) + beta 헤더; 아니면 API 키.
    const client = new Anthropic(
      model.authMode === 'bearer'
        ? { authToken: model.apiKey, baseURL: model.baseUrl, defaultHeaders: model.extraHeaders }
        : { apiKey: model.apiKey, baseURL: model.baseUrl, defaultHeaders: model.extraHeaders },
    )

    // Convert messages to Anthropic format
    const anthropicMessages = this.convertMessages(messages)

    // Convert tools to Anthropic format
    const anthropicTools = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }))

    const params: Anthropic.MessageCreateParamsStreaming = {
      model: model.model,
      max_tokens: model.maxTokens ?? 8192,
      temperature: model.temperature ?? 0.7,
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true,
      ...(anthropicTools && anthropicTools.length > 0
        ? { tools: anthropicTools as Anthropic.Tool[] }
        : {}),
    }

    // Track tool call IDs by content block index (local to this stream invocation)
    const toolCallIds = new Map<number, string>()

    try {
      const stream = await client.messages.stream(params, { signal })

      for await (const event of stream) {
        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block
            const idx = event.index
            if (block.type === 'tool_use') {
              toolCallIds.set(idx, block.id)
              yield { type: 'tool_call_start', id: block.id, name: block.name }
            }
            break
          }

          case 'content_block_delta': {
            const delta = event.delta
            const idx = event.index
            if (delta.type === 'text_delta') {
              yield { type: 'text_delta', text: delta.text }
            } else if (delta.type === 'input_json_delta') {
              const id = toolCallIds.get(idx) ?? ''
              yield {
                type: 'tool_call_delta',
                id,
                argumentsDelta: delta.partial_json,
              }
            }
            break
          }

          case 'content_block_stop': {
            const idx = event.index
            const id = toolCallIds.get(idx)
            if (id) {
              yield { type: 'tool_call_end', id }
              toolCallIds.delete(idx)
            }
            break
          }

          case 'message_delta': {
            if (event.delta.stop_reason) {
              yield { type: 'done', stopReason: event.delta.stop_reason }
            }
            break
          }
        }
      }
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') {
        yield { type: 'done', stopReason: 'aborted' }
      } else {
        yield { type: 'error', message: err.message }
      }
    }
  }

  /**
   * Convert provider-agnostic LLMMessage[] to Anthropic message format.
   * Anthropic separates system prompt from messages, and uses a specific
   * content block format for tool calls and results.
   */
  private convertMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = []

    for (const msg of messages) {
      if (msg.role === 'system') continue  // System is passed separately

      const parts = this.convertContentParts(msg.content, msg.role)
      if (parts.length === 0) continue

      result.push({ role: msg.role as 'user' | 'assistant', content: parts })
    }

    return result
  }

  private convertContentParts(
    parts: LLMContentPart[],
    role: string,
  ): Anthropic.ContentBlockParam[] {
    const result: Anthropic.ContentBlockParam[] = []

    for (const part of parts) {
      if (part.type === 'text') {
        result.push({ type: 'text', text: part.text })
      } else if (part.type === 'tool_call' && role === 'assistant') {
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(part.arguments) } catch { /* empty */ }
        result.push({
          type: 'tool_use',
          id: part.id,
          name: part.name,
          input: parsed,
        })
      } else if (part.type === 'tool_result' && role === 'user') {
        result.push({
          type: 'tool_result',
          tool_use_id: part.toolCallId,
          content: part.content,
          is_error: part.isError,
        })
      }
    }

    return result
  }
}
