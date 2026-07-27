/**
 * Wiki Routes
 *
 * Project-scoped:
 *   GET    /projects/:id/wiki                 - list
 *   GET    /projects/:id/wiki/page?path=      - get by path
 *   POST   /projects/:id/wiki                 - upsert (agent-driven)
 *   DELETE /projects/:id/wiki/page?path=      - remove
 *   GET    /projects/:id/wiki/search?q=       - full-text search
 *   GET    /projects/:id/wiki/backlinks?path= - backlinks
 *   GET    /projects/:id/wiki/sync-state      - commit watermark
 *
 * Global / master:
 *   GET    /wiki/master                       - list master pages
 *   GET    /wiki/master/page?path=            - get master page
 *   GET    /wiki/master/search?q=             - search master
 *   POST   /wiki/master/sync                  - trigger master aggregation
 *   GET    /dashboard                         - cross-project dashboard
 */

import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { tasks, plans, projects, wikiLog } from '../db/schema.js'
import { wikiService } from '../services/wiki-service.js'
import { aggregateMasterWiki } from '../services/wiki-aggregation.js'
import { createWikiPageSchema } from '@mydevbox/shared'
import type {
  ApiResponse,
  WikiPage,
  WikiSearchHit,
  WikiBacklink,
  WikiSyncState,
  WikiLogEntry,
} from '@mydevbox/shared'
import { desc } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function wikiRoutes(app: FastifyInstance): Promise<void> {
  // ============ 프로젝트 위키: 목록 ============
  app.get('/projects/:id/wiki', async (request): Promise<ApiResponse<WikiPage[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return { success: false, error: 'Invalid project ID' }
    const list = await wikiService.list(id)
    return { success: true, data: list }
  })

  // ============ 프로젝트 위키: 경로 조회 ============
  app.get('/projects/:id/wiki/page', async (request, reply): Promise<ApiResponse<WikiPage>> => {
    const { id } = request.params as { id: string }
    const { path } = request.query as { path?: string }
    if (!UUID_RE.test(id)) return { success: false, error: 'Invalid project ID' }
    if (!path) { reply.code(400); return { success: false, error: 'path is required' } }

    const page = await wikiService.getByPath(id, path)
    if (!page) { reply.code(404); return { success: false, error: 'Wiki page not found' } }
    return { success: true, data: page }
  })

  // ============ 프로젝트 위키: upsert ============
  app.post('/projects/:id/wiki', async (request, reply): Promise<ApiResponse<WikiPage>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return { success: false, error: 'Invalid project ID' }

    const parsed = createWikiPageSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const page = await wikiService.upsert(id, parsed.data)
    return { success: true, data: page }
  })

  // ============ 프로젝트 위키: 삭제 ============
  app.delete('/projects/:id/wiki/page', async (request): Promise<ApiResponse<null>> => {
    const { id } = request.params as { id: string }
    const { path } = request.query as { path?: string }
    if (!UUID_RE.test(id)) return { success: false, error: 'Invalid project ID' }
    if (!path) return { success: false, error: 'path is required' }

    await wikiService.remove(id, path)
    return { success: true, data: null }
  })

  // ============ 프로젝트 위키: 검색 ============
  app.get('/projects/:id/wiki/search', async (request): Promise<ApiResponse<WikiSearchHit[]>> => {
    const { id } = request.params as { id: string }
    const { q, limit } = request.query as { q?: string; limit?: string }
    if (!UUID_RE.test(id)) return { success: false, error: 'Invalid project ID' }

    const hits = await wikiService.search('project', id, q ?? '', limit ? parseInt(limit, 10) : 20)
    return { success: true, data: hits }
  })

  // ============ 프로젝트 위키: 백링크 ============
  app.get('/projects/:id/wiki/backlinks', async (request): Promise<ApiResponse<WikiBacklink[]>> => {
    const { id } = request.params as { id: string }
    const { path } = request.query as { path?: string }
    if (!UUID_RE.test(id)) return { success: false, error: 'Invalid project ID' }
    if (!path) return { success: false, error: 'path is required' }

    const backlinks = await wikiService.getBacklinks(id, path)
    return { success: true, data: backlinks }
  })

  // ============ 프로젝트 위키: 커밋 워터마크 ============
  app.get('/projects/:id/wiki/sync-state', async (request): Promise<ApiResponse<WikiSyncState | null>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return { success: false, error: 'Invalid project ID' }

    const state = await wikiService.getSyncState(id)
    return { success: true, data: state }
  })

  // ============ 마스터 위키: 목록 ============
  app.get('/wiki/master', async (): Promise<ApiResponse<WikiPage[]>> => {
    const list = await wikiService.list(null)
    return { success: true, data: list }
  })

  // ============ 마스터 위키: 경로 조회 ============
  app.get('/wiki/master/page', async (request, reply): Promise<ApiResponse<WikiPage>> => {
    const { path } = request.query as { path?: string }
    if (!path) { reply.code(400); return { success: false, error: 'path is required' } }

    const page = await wikiService.getByPath(null, path)
    if (!page) { reply.code(404); return { success: false, error: 'Master wiki page not found' } }
    return { success: true, data: page }
  })

  // ============ 마스터 위키: 검색 ============
  app.get('/wiki/master/search', async (request): Promise<ApiResponse<WikiSearchHit[]>> => {
    const { q, limit } = request.query as { q?: string; limit?: string }
    const hits = await wikiService.search('master', null, q ?? '', limit ? parseInt(limit, 10) : 20)
    return { success: true, data: hits }
  })

  // ============ 마스터 위키: 집계 트리거 ============
  app.post('/wiki/master/sync', async (): Promise<ApiResponse<{ count: number }>> => {
    const result = await aggregateMasterWiki()
    return { success: true, data: result }
  })

  // ============ 글로벌 대시보드 (크로스프로젝트) ============
  app.get('/dashboard', async (): Promise<ApiResponse<unknown>> => {
    // 전체 프로젝트
    const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects)
    const nameById = new Map(projectRows.map(p => [p.id, p.name]))

    // 전체 태스크 → 상태별 그룹
    const taskRows = await db.select({
      id: tasks.id, projectId: tasks.projectId, title: tasks.title,
      status: tasks.status, priority: tasks.priority,
    }).from(tasks)

    const byStatus = (status: string) => taskRows
      .filter(t => (t.status ?? 'pending') === status)
      .map(t => ({ id: t.id, projectId: t.projectId, name: nameById.get(t.projectId) ?? '?', title: t.title, priority: t.priority ?? 'medium' }))

    // 전체 플랜 (로드맵)
    const planRows = await db.select({
      id: plans.id, projectId: plans.projectId, title: plans.title,
      version: plans.version, content: plans.content, createdAt: plans.createdAt,
    }).from(plans).orderBy(desc(plans.createdAt))

    // 마스터 위키 + 최근 로그
    const masterPages = await wikiService.list(null)
    const logRows = await db.select().from(wikiLog).orderBy(desc(wikiLog.createdAt)).limit(25)
    const recentLog: WikiLogEntry[] = logRows.map(r => ({
      id: r.id, projectId: r.projectId, op: r.op as WikiLogEntry['op'],
      summary: r.summary, meta: (r.meta ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }))

    return {
      success: true,
      data: {
        projects: projectRows,
        tasksByStatus: {
          pending: byStatus('pending'),
          in_progress: byStatus('in_progress'),
          completed: byStatus('completed'),
        },
        plans: planRows.map(p => ({
          id: p.id, projectId: p.projectId, name: nameById.get(p.projectId) ?? '?',
          title: p.title, version: p.version, createdAt: p.createdAt.toISOString(),
        })),
        masterPages,
        recentLog,
      },
    }
  })
}
