import type { FastifyInstance } from 'fastify'
import { projectService } from '../services/project-service.js'
import { createProjectSchema, updateProjectSchema } from '@mydevbox/shared'
import type { ApiResponse, Project, ScannedDir } from '@mydevbox/shared'

// UUID 형식 검증
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // ============ 목록 조회 ============
  app.get('/projects', async (): Promise<ApiResponse<Project[]>> => {
    const list = await projectService.list()
    return { success: true, data: list }
  })

  // ============ 디렉토리 스캔 ============
  // /projects/:id 보다 먼저 등록해야 라우트 충돌 회피
  app.get('/projects/scan', async (request): Promise<ApiResponse<ScannedDir[]>> => {
    const { dir } = request.query as { dir?: string }
    if (!dir) {
      return { success: false, error: 'dir query parameter is required' }
    }
    const scanned = await projectService.scanDir(dir)
    return { success: true, data: scanned }
  })

  // ============ 생성 ============
  app.post('/projects', async (request, reply): Promise<ApiResponse<Project>> => {
    const parsed = createProjectSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Validation Error',
        details: parsed.error.issues,
      })
    }

    try {
      const project = await projectService.create(parsed.data)
      return { success: true, data: project }
    } catch (e) {
      const statusCode = (e as Error & { statusCode?: number }).statusCode ?? 500
      return reply.code(statusCode).send({
        success: false,
        error: (e as Error).message,
      })
    }
  })

  // ============ 상세 조회 ============
  app.get('/projects/:id', async (request, reply): Promise<ApiResponse<Project>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({
        success: false,
        error: `Project not found: ${id}`,
      })
    }
    const project = await projectService.getById(id)
    if (!project) {
      return reply.code(404).send({
        success: false,
        error: `Project not found: ${id}`,
      })
    }
    return { success: true, data: project }
  })

  // ============ 수정 ============
  app.put('/projects/:id', async (request, reply): Promise<ApiResponse<Project>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({
        success: false,
        error: `Project not found: ${id}`,
      })
    }
    const parsed = updateProjectSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Validation Error',
        details: parsed.error.issues,
      })
    }

    try {
      const project = await projectService.update(id, parsed.data)
      return { success: true, data: project }
    } catch (e) {
      const statusCode = (e as Error & { statusCode?: number }).statusCode ?? 500
      return reply.code(statusCode).send({
        success: false,
        error: (e as Error).message,
      })
    }
  })

  // ============ 삭제 ============
  app.delete('/projects/:id', async (request, reply): Promise<ApiResponse<null>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({
        success: false,
        error: `Project not found: ${id}`,
      })
    }
    const { deleteFiles } = request.query as { deleteFiles?: string }

    try {
      await projectService.delete(id, deleteFiles === 'true')
      return { success: true }
    } catch (e) {
      const statusCode = (e as Error & { statusCode?: number }).statusCode ?? 500
      return reply.code(statusCode).send({
        success: false,
        error: (e as Error).message,
      })
    }
  })

  // ============ 열기 ============
  app.post('/projects/:id/open', async (request, reply): Promise<ApiResponse<Project>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({
        success: false,
        error: `Project not found: ${id}`,
      })
    }

    try {
      const project = await projectService.open(id)
      return { success: true, data: project }
    } catch (e) {
      const statusCode = (e as Error & { statusCode?: number }).statusCode ?? 500
      return reply.code(statusCode).send({
        success: false,
        error: (e as Error).message,
      })
    }
  })
}
