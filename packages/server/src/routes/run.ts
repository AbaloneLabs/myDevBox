/**
 * Run Routes (Plan 9 - 코드 실행 & 터미널)
 *
 * POST   /projects/:id/run                - 파일/명령 실행
 * GET    /projects/:id/run-presets        - 프리셋 목록 (자동 감지 + DB)
 * POST   /projects/:id/run-presets        - 프리셋 생성
 * DELETE /projects/:id/run-presets/:presetId - 프리셋 삭제
 */

import type { FastifyInstance } from 'fastify'
import { runService } from '../terminal/run-service.js'
import { projectService } from '../services/project-service.js'
import { runFileSchema, createRunPresetSchema } from '@mydevbox/shared'
import type { ApiResponse, RunResult, RunPreset } from '@mydevbox/shared'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // ============ 파일/명령 실행 ============
  app.post('/projects/:id/run', async (request, reply): Promise<ApiResponse<RunResult>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return { success: false, error: 'Invalid project ID' }
    }

    const parsed = runFileSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const project = await projectService.getById(id)
    if (!project) {
      reply.code(404)
      return { success: false, error: 'Project not found' }
    }

    try {
      const result = await runService.runFile(id, project.path, parsed.data)
      return { success: true, data: result }
    } catch (err) {
      const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500
      reply.code(statusCode)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Execution failed',
      }
    }
  })

  // ============ 프리셋 목록 ============
  app.get('/projects/:id/run-presets', async (request): Promise<ApiResponse<RunPreset[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return { success: false, error: 'Invalid project ID' }
    }

    const project = await projectService.getById(id)
    if (!project) {
      return { success: false, error: 'Project not found' }
    }

    const presets = await runService.getPresets(id, project.path)
    return { success: true, data: presets }
  })

  // ============ 프리셋 생성 ============
  app.post('/projects/:id/run-presets', async (request, reply): Promise<ApiResponse<RunPreset>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return { success: false, error: 'Invalid project ID' }
    }

    const parsed = createRunPresetSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const preset = await runService.createPreset(id, parsed.data)
    return { success: true, data: preset }
  })

  // ============ 프리셋 삭제 ============
  app.delete(
    '/projects/:id/run-presets/:presetId',
    async (request, reply): Promise<ApiResponse<null>> => {
      const { id, presetId } = request.params as { id: string; presetId: string }
      if (!UUID_RE.test(id) || !UUID_RE.test(presetId)) {
        return { success: false, error: 'Invalid ID' }
      }

      await runService.deletePreset(id, presetId)
      reply.code(204)
      return { success: true, data: null }
    },
  )
}
