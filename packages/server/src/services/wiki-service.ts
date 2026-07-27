/**
 * Wiki Service
 *
 * Self-maintaining LLM wiki storage. Pages live in the DB and are mirrored
 * to a markdown file (project: <projectPath>/<path>, master: <masterWikiDir>/<path>).
 * projectId === null means the cross-project master wiki.
 *
 * Mirrors DocService patterns (rowTo*, getProjectPath, file mirror write).
 */

import fs from 'node:fs'
import path from 'node:path'
import { eq, and, isNull, desc, sql } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { wikiPages, wikiLog, wikiSyncState } from '../db/schema.js'
import { projects } from '../db/schema.js'
import { expandTilde } from './path-service.js'
import { config } from '../config.js'
import type {
  WikiPage,
  WikiFrontmatter,
  WikiPageType,
  WikiPageStatus,
  WikiLogEntry,
  WikiSyncState,
  WikiSearchHit,
  WikiBacklink,
} from '@mydevbox/shared'

function rowToWikiPage(row: typeof wikiPages.$inferSelect): WikiPage {
  return {
    id: row.id,
    projectId: row.projectId,
    path: row.path,
    title: row.title,
    type: row.type as WikiPageType,
    content: row.content,
    frontmatter: (row.frontmatter ?? {}) as WikiFrontmatter,
    tags: row.tags ?? [],
    status: (row.status ?? 'active') as WikiPageStatus,
    sha: row.sha ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function rowToLog(row: typeof wikiLog.$inferSelect): WikiLogEntry {
  return {
    id: row.id,
    projectId: row.projectId,
    op: row.op as WikiLogEntry['op'],
    summary: row.summary,
    meta: (row.meta ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  }
}

async function getProjectPath(projectId: string): Promise<string> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!row) throw new Error('Project not found')
  return expandTilde(row.path)
}

/** Root directory for the file mirror. null projectId → master wiki dir. */
async function getMirrorRoot(projectId: string | null): Promise<string> {
  if (projectId === null) {
    const dir = config.masterWikiDir
    await fs.promises.mkdir(dir, { recursive: true })
    return dir
  }
  return getProjectPath(projectId)
}

export interface WikiUpsertInput {
  path: string
  title: string
  content: string
  type?: WikiPageType
  tags?: string[]
  frontmatter?: WikiFrontmatter
  status?: WikiPageStatus
  sha?: string | null
}

export class WikiService {
  // ============ Read ============

  /** List pages in a scope. projectId=null → master. */
  async list(projectId: string | null): Promise<WikiPage[]> {
    const rows = projectId === null
      ? await db.select().from(wikiPages).where(isNull(wikiPages.projectId))
      : await db.select().from(wikiPages).where(eq(wikiPages.projectId, projectId))
    return rows.map(rowToWikiPage).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getByPath(projectId: string | null, pagePath: string): Promise<WikiPage | null> {
    const cond = projectId === null
      ? and(isNull(wikiPages.projectId), eq(wikiPages.path, pagePath))
      : and(eq(wikiPages.projectId, projectId), eq(wikiPages.path, pagePath))
    const [row] = await db.select().from(wikiPages).where(cond)
    return row ? rowToWikiPage(row) : null
  }

  /** True if a scope has no pages yet (used to decide bootstrap). */
  async isEmpty(projectId: string): Promise<boolean> {
    const rows = await db.select().from(wikiPages)
      .where(eq(wikiPages.projectId, projectId))
      .limit(1)
    return rows.length === 0
  }

  // ============ Write ============

  /** Insert or update a page by (projectId, path), mirroring to the filesystem. */
  async upsert(projectId: string | null, input: WikiUpsertInput): Promise<WikiPage> {
    // 1. File mirror
    const root = await getMirrorRoot(projectId)
    const fullPath = path.join(root, input.path)
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.promises.writeFile(fullPath, input.content, 'utf-8')

    // 2. Find existing by (projectId, path)
    const cond = projectId === null
      ? and(isNull(wikiPages.projectId), eq(wikiPages.path, input.path))
      : and(eq(wikiPages.projectId, projectId), eq(wikiPages.path, input.path))
    const [existing] = await db.select().from(wikiPages).where(cond)

    const type = input.type ?? 'glossary'
    const tags = input.tags ?? []
    const frontmatter = input.frontmatter ?? {}
    const status = input.status ?? 'active'

    if (existing) {
      const [row] = await db.update(wikiPages).set({
        title: input.title,
        content: input.content,
        type,
        tags,
        frontmatter,
        status,
        sha: input.sha === undefined ? existing.sha : input.sha,
        updatedAt: new Date(),
      }).where(eq(wikiPages.id, existing.id)).returning()
      return rowToWikiPage(row)
    }

    const [row] = await db.insert(wikiPages).values({
      projectId: projectId ?? undefined,
      path: input.path,
      title: input.title,
      content: input.content,
      type,
      tags,
      frontmatter,
      status,
      sha: input.sha ?? null,
    }).returning()
    return rowToWikiPage(row)
  }

  async remove(projectId: string | null, pagePath: string): Promise<void> {
    const cond = projectId === null
      ? and(isNull(wikiPages.projectId), eq(wikiPages.path, pagePath))
      : and(eq(wikiPages.projectId, projectId), eq(wikiPages.path, pagePath))
    await db.delete(wikiPages).where(cond)
  }

  // ============ Log ============

  async appendLog(
    projectId: string | null,
    op: WikiLogEntry['op'],
    summary: string,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    await db.insert(wikiLog).values({
      projectId: projectId ?? undefined,
      op,
      summary,
      meta,
    })
  }

  async getRecentLog(projectId: string | null, limit = 10): Promise<WikiLogEntry[]> {
    const cond = projectId === null
      ? isNull(wikiLog.projectId)
      : eq(wikiLog.projectId, projectId)
    const rows = await db.select().from(wikiLog)
      .where(cond)
      .orderBy(desc(wikiLog.createdAt))
      .limit(limit)
    return rows.map(rowToLog)
  }

  // ============ Search ============

  /**
   * Full-text search via pg tsvector. scope: 'project' (this project),
   * 'master' (projectId IS NULL), 'both' (project ∪ master).
   * Empty query → most recently updated pages.
   */
  async search(
    scope: 'project' | 'master' | 'both',
    projectId: string | null,
    query: string,
    limit = 20,
  ): Promise<WikiSearchHit[]> {
    const q = (query ?? '').trim()

    if (!q) {
      // Recent pages in scope
      let rows: typeof wikiPages.$inferSelect[]
      if (scope === 'master') {
        rows = await db.select().from(wikiPages).where(isNull(wikiPages.projectId))
          .orderBy(desc(wikiPages.updatedAt)).limit(limit)
      } else if (scope === 'project' && projectId) {
        rows = await db.select().from(wikiPages).where(eq(wikiPages.projectId, projectId))
          .orderBy(desc(wikiPages.updatedAt)).limit(limit)
      } else {
        rows = await db.select().from(wikiPages).orderBy(desc(wikiPages.updatedAt)).limit(limit)
      }
      return rows.map(r => ({
        path: r.path, title: r.title, type: r.type as WikiPageType,
        snippet: r.content.slice(0, 160), score: 0,
      }))
    }

    let scopeSql
    if (scope === 'master') scopeSql = sql`project_id IS NULL`
    else if (scope === 'project' && projectId) scopeSql = sql`project_id = ${projectId}`
    else if (projectId) scopeSql = sql`(project_id = ${projectId} OR project_id IS NULL)`
    else scopeSql = sql`project_id IS NULL`

    const result = await db.execute(sql`
      SELECT path, title, type,
        ts_headline('english', content, plainto_tsquery(${q}), 'MaxWords=35,MinWords=15,MaxFragments=1') AS snippet,
        ts_rank(search_vector, plainto_tsquery(${q})) AS score
      FROM wiki_pages
      WHERE ${scopeSql} AND search_vector @@ plainto_tsquery(${q})
      ORDER BY score DESC
      LIMIT ${limit}
    `)

    const hits = (Array.isArray(result) ? result : []) as Array<{
      path: string; title: string; type: WikiPageType
      snippet: string; score: string | number
    }>

    if (hits.length > 0) {
      return hits.map(h => ({
        path: h.path, title: h.title, type: h.type,
        snippet: h.snippet, score: typeof h.score === 'string' ? parseFloat(h.score) : h.score,
      }))
    }

    // Fallback: ILIKE when tsvector finds nothing (short queries, names)
    const like = `%${q}%`
    const fb = await db.execute(sql`
      SELECT path, title, type FROM wiki_pages
      WHERE ${scopeSql} AND (title ILIKE ${like} OR content ILIKE ${like})
      LIMIT ${limit}
    `)
    return ((Array.isArray(fb) ? fb : []) as Array<{ path: string; title: string; type: WikiPageType }>)
      .map(r => ({ path: r.path, title: r.title, type: r.type, snippet: '', score: 0 }))
  }

  // ============ Backlinks ============

  /** Pages linking to the target via `[[Target]]` (basename without extension). */
  async getBacklinks(projectId: string, pagePath: string): Promise<WikiBacklink[]> {
    const basename = path.basename(pagePath).replace(/\.md$/i, '')
    const like = `%[[${basename}]]%`
    const rows = await db.select().from(wikiPages)
      .where(and(eq(wikiPages.projectId, projectId), sql`${wikiPages.content} ILIKE ${like}`))
    return rows.map(r => {
      const idx = r.content.indexOf(`[[${basename}]]`)
      const start = Math.max(0, idx - 60)
      const end = Math.min(r.content.length, idx + basename.length + 62)
      return {
        fromPath: r.path,
        fromTitle: r.title,
        context: r.content.slice(start, end).replace(/\s+/g, ' ').trim(),
      }
    })
  }

  // ============ Preamble (for system prompt) ============

  /** First N lines of index.md + recent M log entries, for the system prompt. */
  async buildPreamble(
    projectId: string,
    opts: { indexLines?: number; logEntries?: number } = {},
  ): Promise<string> {
    const indexLines = opts.indexLines ?? 40
    const logEntries = opts.logEntries ?? 10

    const index = await this.getByPath(projectId, 'wiki/index.md')
    if (!index) return 'Wiki is being bootstrapped — see wiki/index.md once ready.'

    const head = index.content.split('\n').slice(0, indexLines).join('\n')
    const log = await this.getRecentLog(projectId, logEntries)
    const logBlock = log.length === 0
      ? '(no maintenance log yet)'
      : log.map(l => `- [${l.op}] ${l.summary}`).join('\n')

    return `# wiki/index.md (head, ${indexLines} lines)\n${head}\n\n# wiki/log.md (recent ${logEntries})\n${logBlock}`
  }

  // ============ Commit watermark ============

  async getSyncState(projectId: string): Promise<WikiSyncState | null> {
    const [row] = await db.select().from(wikiSyncState)
      .where(eq(wikiSyncState.projectId, projectId))
    if (!row) return null
    return {
      projectId: row.projectId,
      lastCommitSha: row.lastCommitSha ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  async setSyncState(projectId: string, lastCommitSha: string | null): Promise<void> {
    const [existing] = await db.select().from(wikiSyncState)
      .where(eq(wikiSyncState.projectId, projectId))
    if (existing) {
      await db.update(wikiSyncState).set({
        lastCommitSha,
        updatedAt: new Date(),
      }).where(eq(wikiSyncState.projectId, projectId))
    } else {
      await db.insert(wikiSyncState).values({ projectId, lastCommitSha })
    }
  }
}

export const wikiService = new WikiService()
