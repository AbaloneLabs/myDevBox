/**
 * Fetch Tool
 *
 * Fetches content from a URL and converts HTML to Markdown.
 * Based on forgecode's NetFetch.
 *
 * Uses turndown for HTML → Markdown conversion.
 * Large pages are truncated to the first 40,000 characters.
 */

import TurndownService from 'turndown'
import type { AgentTool, ToolResult } from '../types.js'
import type { ToolFactory } from './types.js'

const MAX_FETCH_LENGTH = 40_000

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError }
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

export const createFetchTool: ToolFactory = () => {
  const tool: AgentTool = {
    name: 'fetch',
    description: 'Fetch content from a URL. HTML pages are automatically converted to Markdown. Binary files and non-text content are rejected. Large pages are truncated to the first 40,000 characters.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        raw: { type: 'boolean', default: false, description: 'Return raw content without Markdown conversion' },
      },
      required: ['url'],
    },
    async execute(_id, args) {
      const url = args.url as string
      const raw = (args.raw as boolean) ?? false

      // Validate URL
      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        return textResult(`Invalid URL: ${url}`, true)
      }

      // Only allow http/https
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return textResult(`Only HTTP(S) URLs are supported: ${url}`, true)
      }

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'MyDevBox-Agent/1.0',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        })

        if (!response.ok) {
          return textResult(`HTTP ${response.status} ${response.statusText}: ${url}`, true)
        }

        const contentType = response.headers.get('content-type') ?? ''

        // Reject binary content
        if (
          !contentType.includes('text/') &&
          !contentType.includes('application/json') &&
          !contentType.includes('application/xml') &&
          !contentType.includes('application/javascript') &&
          !contentType.includes('application/x-yaml')
        ) {
          return textResult(
            `Unsupported content type: ${contentType}. Only text-based content is supported.`,
            true,
          )
        }

        let content = await response.text()

        // Convert HTML to Markdown
        if (!raw && contentType.includes('text/html')) {
          content = turndown.turndown(content)
        }

        // Truncate large content
        let truncated = false
        if (content.length > MAX_FETCH_LENGTH) {
          content = content.slice(0, MAX_FETCH_LENGTH)
          truncated = true
        }

        let result = content
        if (truncated) {
          result += `\n\n... (content truncated at ${MAX_FETCH_LENGTH} characters)`
        }

        return textResult(result)
      } catch (e) {
        const err = e as Error
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
          return textResult(`Request timed out: ${url}`, true)
        }
        return textResult(`Fetch failed: ${err.message}`, true)
      }
    },
  }

  return tool
}
