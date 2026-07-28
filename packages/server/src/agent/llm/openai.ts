/**
 * OpenAI LLM Provider
 *
 * Uses openai SDK for streaming with function calling support.
 * Based on pi's openai implementation (opensource/pi/packages/ai/src/api/openai-responses.ts)
 */

import OpenAI from 'openai'
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

export class OpenAIProvider implements LLMProvider {
  async *stream(
    model: ModelConfig,
    systemPrompt: string,
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const client = new OpenAI({ apiKey: model.apiKey, baseURL: model.baseUrl, defaultHeaders: model.extraHeaders })

    // Convert messages to OpenAI format
    const openaiMessages = this.convertMessages(messages, systemPrompt)

    // Convert tools to OpenAI function format
    const openaiTools = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }))

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: model.model,
      max_tokens: model.maxTokens ?? 8192,
      temperature: model.temperature ?? 0.7,
      messages: openaiMessages,
      stream: true,
      ...(openaiTools && openaiTools.length > 0 ? { tools: openaiTools } : {}),
    }

    try {
      const stream = await client.chat.completions.create(params, { signal })

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        if (!delta) continue

        // Text content
        if (delta.content) {
          yield { type: 'text_delta', text: delta.content }
        }

        // Tool calls (function calls)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id && tc.function?.name) {
              // New tool call started
              yield {
                type: 'tool_call_start',
                id: tc.id,
                name: tc.function.name,
              }
            }
            if (tc.function?.arguments) {
              yield {
                type: 'tool_call_delta',
                id: tc.id ?? '',
                argumentsDelta: tc.function.arguments,
              }
            }
            if (tc.id && !tc.function?.arguments && !tc.function?.name) {
              // Tool call ended (index-based, no explicit end signal in OpenAI)
              yield { type: 'tool_call_end', id: tc.id }
            }
          }
        }

        // Finish reason
        const finishReason = chunk.choices[0]?.finish_reason
        if (finishReason) {
          const mapped = finishReason === 'tool_calls' ? 'tool_use' : finishReason
          yield { type: 'done', stopReason: mapped }
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
   * Convert provider-agnostic LLMMessage[] to OpenAI message format.
   * OpenAI uses system messages inline, and function/tool role for results.
   */
  private convertMessages(
    messages: LLMMessage[],
    systemPrompt: string,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []

    // System prompt first
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt })
    }

    for (const msg of messages) {
      if (msg.role === 'system') continue  // Already added

      const parts = msg.content

      // Check if this message has tool results
      const toolResults = parts.filter(p => p.type === 'tool_result')
      const toolCalls = parts.filter(p => p.type === 'tool_call')
      const textParts = parts.filter(p => p.type === 'text')

      if (toolResults.length > 0) {
        // Tool results → separate tool messages
        for (const tr of toolResults) {
          if (tr.type === 'tool_result') {
            result.push({
              role: 'tool',
              tool_call_id: tr.toolCallId,
              content: tr.content,
            })
          }
        }
      } else if (toolCalls.length > 0) {
        // Assistant message with tool calls
        result.push({
          role: 'assistant',
          content: textParts.map(p => p.type === 'text' ? p.text : '').join('') || null,
          tool_calls: toolCalls.map(tc => {
            if (tc.type !== 'tool_call') return null
            return {
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments },
            }
          }).filter(Boolean) as any,
        })
      } else if (textParts.length > 0) {
        // Plain text message
        result.push({
          role: msg.role as 'user' | 'assistant',
          content: textParts.map(p => p.type === 'text' ? p.text : '').join(''),
        })
      }
    }

    return result
  }
}
