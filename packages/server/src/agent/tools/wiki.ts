/**
 * Wiki Tools (agent-facing)
 *
 * wiki_query / wiki_read / wiki_write / wiki_lint
 *
 * The wiki is the project's accumulating memory. The agent maintains it
 * proactively — these tools are the single read/write surface. Mirrors the
 * createDbTodoTools pattern (bound projectId, WebSocket broadcast on write).
 */

import type { AgentTool, ToolResult } from '../types.js'
import { lintWiki } from '../../services/wiki-lint.js'
import { wikiService } from '../../services/wiki-service.js'
import { connectionManager } from '../../ws/connection.js'
import type { WikiPageType } from '@mydevbox/shared'

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError }
}

const MEMORY_NOTE =
  'The wiki is this project\'s accumulating memory — query it before answering architecture/design questions and write to it after making changes.'

/**
 * Factory: DB-backed wiki tools bound to a project (projectId known).
 * Used by the WebSocket message handler where projectId is available.
 */
export function createDbWikiTools(projectId: string): AgentTool[] {
  const wikiQuery: AgentTool = {
    name: 'wiki_query',
    description: `Search the project wiki (and optionally the cross-project master wiki). ${MEMORY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language or keyword search.' },
        scope: {
          type: 'string',
          enum: ['project', 'master', 'both'],
          description: "project (default), master (cross-project), or both.",
        },
      },
      required: ['query'],
    },
    async execute(_id, args) {
      const query = (args.query as string) ?? ''
      const scope = ((args.scope as string) ?? 'project') as 'project' | 'master' | 'both'
      const hits = await wikiService.search(scope, projectId, query, 20)
      if (hits.length === 0) return textResult(`No wiki hits for "${query}" (scope=${scope}).`)
      const body = hits
        .map(h => `- ${h.title} [${h.type}] (${h.path})${h.snippet ? `\n    ${h.snippet.replace(/\s+/g, ' ').trim().slice(0, 160)}` : ''}`)
        .join('\n')
      return textResult(`Wiki hits for "${query}" (${hits.length}):\n${body}`)
    },
  }

  const wikiRead: AgentTool = {
    name: 'wiki_read',
    description: `Read a wiki page by path (project scope by default; scope='master' for the cross-project master wiki). ${MEMORY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Wiki page path, e.g. wiki/index.md or wiki/models/user.md.' },
        scope: { type: 'string', enum: ['project', 'master'] },
      },
      required: ['path'],
    },
    async execute(_id, args) {
      const pagePath = args.path as string
      const scope = (args.scope as string) ?? 'project'
      const targetId = scope === 'master' ? null : projectId
      const page = await wikiService.getByPath(targetId, pagePath)
      if (!page) return textResult(`Wiki page not found: ${pagePath} (scope=${scope}).`, true)
      return textResult(`# ${page.title} (${page.path}) [type=${page.type} status=${page.status}]\n\n${page.content}`)
    },
  }

  const wikiWrite: AgentTool = {
    name: 'wiki_write',
    description: `Create or update a wiki page (full content). Use after code changes, decisions, or discoveries. scope='master' writes the cross-project master wiki. ${MEMORY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Wiki page path, e.g. wiki/decisions.md.' },
        title: { type: 'string' },
        content: { type: 'string', description: 'Full markdown content of the page.' },
        type: {
          type: 'string',
          enum: ['index', 'log', 'gaps', 'model', 'controller', 'service', 'route', 'architecture', 'decision', 'dependency', 'roadmap', 'debt', 'plan', 'pattern', 'learning', 'convention', 'project_summary', 'glossary'],
        },
        tags: { type: 'array', items: { type: 'string' } },
        scope: { type: 'string', enum: ['project', 'master'] },
      },
      required: ['path', 'title', 'content'],
    },
    async execute(_id, args) {
      const pagePath = args.path as string
      const title = args.title as string
      const content = args.content as string
      const scope = (args.scope as string) ?? 'project'
      const targetId = scope === 'master' ? null : projectId

      const page = await wikiService.upsert(targetId, {
        path: pagePath,
        title,
        content,
        type: args.type as WikiPageType | undefined,
        tags: args.tags as string[] | undefined,
      })

      // Log + broadcast (project scope only has a WebSocket audience)
      await wikiService.appendLog(targetId, 'ingest', `Updated ${pagePath}: ${title}`, {
        scope, type: page.type,
      })
      if (targetId !== null) {
        connectionManager.broadcast(targetId, {
          type: 'wiki_updated', projectId: targetId, path: pagePath,
        })
      }

      return textResult(`Wiki page ${scope === 'master' ? '[master] ' : ''}${pagePath} saved (type=${page.type}).`)
    },
  }

  const wikiLint: AgentTool = {
    name: 'wiki_lint',
    description: `3-tier wiki audit. Safe fixes: index↔page mismatches and broken [[wikilinks]]. Mechanical: sha freshness (recompute cited source hash) and vanished frontmatter.source paths. Judgment: orphan pages and stale-claim candidates to review. Pass fix=true to apply safe fixes and mark outdated pages. ${MEMORY_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'master'] },
        fix: { type: 'boolean', description: 'Apply safe fixes and mark outdated pages.' },
      },
    },
    async execute(_id, args) {
      const scope = (args.scope as string) ?? 'project'
      const fix = (args.fix as boolean) ?? false
      const targetId = scope === 'master' ? null : projectId
      const r = await lintWiki(targetId, { fix })
      const parts: string[] = [`Wiki lint (${scope}, fix=${fix}) — ${r.checked} pages checked.`]
      if (r.safeFixes.length) parts.push(`Safe fixes (${r.safeFixes.length}):\n${r.safeFixes.slice(0, 40).join('\n')}`)
      if (r.mechanical.length) parts.push(`Mechanical (${r.mechanical.length}):\n${r.mechanical.slice(0, 40).join('\n')}`)
      if (r.judgment.length) parts.push(`Judgment — review (${r.judgment.length}):\n${r.judgment.slice(0, 40).join('\n')}`)
      return textResult(parts.join('\n\n'))
    },
  }

  return [wikiQuery, wikiRead, wikiWrite, wikiLint]
}
