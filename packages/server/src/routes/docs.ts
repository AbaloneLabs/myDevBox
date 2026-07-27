/**
 * Docs Routes
 *
 * GET    /projects/:id/docs           - list
 * GET    /projects/:id/docs/:docId    - get by id
 * POST   /projects/:id/docs           - create (manual)
 * DELETE /projects/:id/docs/:docId    - delete
 * POST   /projects/:id/docs/scan      - scan existing docs/ folder
 */

import type { FastifyInstance } from 'fastify'
import { docService } from '../services/doc-service.js'
import { createDocSchema } from '@mydevbox/shared'
import type { ApiResponse, Doc } from '@mydevbox/shared'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function docRoutes(app: FastifyInstance): Promise<void> {
  // ============ 목록 조회 ============
  app.get('/projects/:id/docs', async (request): Promise<ApiResponse<Doc[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return { success: false, error: 'Invalid project ID' }
    }
    const list = await docService.list(id)
    return { success: true, data: list }
  })

  // ============ 기존 문서 스캔 ============
  // /projects/:id/docs/:docId 보다 먼저 등록
  app.post('/projects/:id/docs/scan', async (request): Promise<ApiResponse<Doc[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return { success: false, error: 'Invalid project ID' }
    }
    const newDocs = await docService.scanExistingDocs(id)
    return { success: true, data: newDocs }
  })

  // ============ 상세 조회 ============
  app.get('/projects/:id/docs/:docId', async (request, reply): Promise<ApiResponse<Doc>> => {
    const { docId } = request.params as { docId: string }
    if (!UUID_RE.test(docId)) {
      return { success: false, error: 'Invalid doc ID' }
    }

    const doc = await docService.getById(docId)
    if (!doc) {
      reply.code(404)
      return { success: false, error: 'Doc not found' }
    }

    return { success: true, data: doc }
  })

  // ============ 생성 (수동) ============
  app.post('/projects/:id/docs', async (request, reply): Promise<ApiResponse<Doc>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return { success: false, error: 'Invalid project ID' }
    }

    const parsed = createDocSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const doc = await docService.create(id, parsed.data)
    return { success: true, data: doc }
  })

  // ============ 삭제 ============
  app.delete('/projects/:id/docs/:docId', async (request, reply): Promise<ApiResponse<null>> => {
    const { docId } = request.params as { docId: string }
    if (!UUID_RE.test(docId)) {
      return { success: false, error: 'Invalid doc ID' }
    }

    await docService.delete(docId)
    return { success: true, data: null }
  })
}
