/**
 * Context Manager
 *
 * Manages the context window by estimating token counts and
 * compacting old messages when the conversation gets too long.
 * Based on forgecode's compact module (opensource/forgecode/crates/forge_domain/src/compact/)
 */

import type { Message, ModelConfig, TextContent } from './types.js'
import { convertToLLMMessages } from './llm/provider.js'

export class ContextManager {
  /**
   * Estimate token count for a message array.
   * Rough heuristic: ~4 characters per token.
   */
  estimateTokens(messages: Message[]): number {
    return messages.reduce((sum, msg) => {
      const text = JSON.stringify(msg.content)
      return sum + Math.ceil(text.length / 4)
    }, 0)
  }

  /**
   * Compact messages if they exceed the token limit.
   * Keeps recent messages and summarizes older ones.
   */
  compact(
    messages: Message[],
    maxTokens: number,
  ): Message[] {
    const currentTokens = this.estimateTokens(messages)
    if (currentTokens <= maxTokens) return messages

    // Keep the most recent messages, drop old ones
    const keepRecent = 10
    if (messages.length <= keepRecent) return messages

    const toSummarize = messages.slice(0, -keepRecent)
    const toKeep = messages.slice(-keepRecent)

    // Build a summary of dropped messages
    const summary = this.buildSummary(toSummarize)

    const summaryMessage: Message = {
      id: crypto.randomUUID(),
      role: 'system',
      content: [{ type: 'text', text: summary } as TextContent],
      timestamp: Date.now(),
    }

    return [summaryMessage, ...toKeep]
  }

  /**
   * Build a brief summary of older messages.
   * Extracts text content and tool actions.
   */
  private buildSummary(messages: Message[]): string {
    const parts: string[] = ['[Context summary - earlier conversation]\n']

    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text.trim()) {
          const preview = block.text.slice(0, 200)
          parts.push(`${msg.role}: ${preview}${block.text.length > 200 ? '...' : ''}`)
        } else if (block.type === 'tool_call') {
          parts.push(`tool_call: ${block.name}(${JSON.stringify(block.arguments).slice(0, 100)})`)
        } else if (block.type === 'tool_result') {
          const text = block.content.map(c => c.text).join(' ').slice(0, 100)
          parts.push(`tool_result: ${text}`)
        }
      }
    }

    return parts.join('\n')
  }

  /**
   * Check if context is approaching the limit and should be compacted.
   */
  shouldCompact(messages: Message[], maxTokens: number): boolean {
    return this.estimateTokens(messages) > maxTokens * 0.8
  }
}

export const contextManager = new ContextManager()
