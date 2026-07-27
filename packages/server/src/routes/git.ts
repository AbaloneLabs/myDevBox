import type { FastifyInstance } from 'fastify'
import { gitService } from '../services/git-service.js'
import {
  checkoutSchema,
  commitSchema,
  pushSchema,
} from '@mydevbox/shared'
import type {
  ApiResponse,
  GitInfo,
  GitBranch,
  GitCommit,
  GitDiff,
} from '@mydevbox/shared'

// UUID 형식 검증
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 에러에서 statusCode 추출 (기본 500)
 */
function getStatusCode(e: unknown): number {
  const err = e as Error & { statusCode?: number }
  return err.statusCode ?? 500
}

export async function gitRoutes(app: FastifyInstance): Promise<void> {
  // ============ git status 조회 ============
  app.get('/projects/:id/git/status', async (request, reply): Promise<ApiResponse<GitInfo>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    try {
      const status = await gitService.getStatus(id)
      return { success: true, data: status }
    } catch (e) {
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ 브랜치 목록 조회 ============
  app.get('/projects/:id/git/branches', async (request, reply): Promise<ApiResponse<GitBranch[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    try {
      const branches = await gitService.getBranches(id)
      return { success: true, data: branches }
    } catch (e) {
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ 브랜치 체크아웃 ============
  app.post('/projects/:id/git/checkout', async (request, reply): Promise<ApiResponse<GitInfo>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const parsed = checkoutSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Validation Error',
        details: parsed.error.issues,
      })
    }

    try {
      const status = await gitService.checkout(id, parsed.data.branch, parsed.data.create)
      return { success: true, data: status }
    } catch (e) {
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ 커밋 생성 ============
  app.post('/projects/:id/git/commit', async (request, reply): Promise<ApiResponse<GitInfo>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const parsed = commitSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Validation Error',
        details: parsed.error.issues,
      })
    }

    try {
      const status = await gitService.commit(
        id,
        parsed.data.message,
        parsed.data.files,
        parsed.data.amend,
      )
      return { success: true, data: status }
    } catch (e) {
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ push ============
  app.post('/projects/:id/git/push', async (request, reply): Promise<ApiResponse<null>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const parsed = pushSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Validation Error',
        details: parsed.error.issues,
      })
    }

    try {
      await gitService.push(id, parsed.data.force)
      return { success: true }
    } catch (e) {
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ pull ============
  app.post('/projects/:id/git/pull', async (request, reply): Promise<ApiResponse<GitInfo>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    try {
      const status = await gitService.pull(id)
      return { success: true, data: status }
    } catch (e) {
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ 커밋 히스토리 ============
  app.get('/projects/:id/git/log', async (request, reply): Promise<ApiResponse<GitCommit[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const query = request.query as { limit?: string; branch?: string }

    try {
      const log = await gitService.getLog(
        id,
        query.limit ? parseInt(query.limit, 10) : 50,
        query.branch,
      )
      return { success: true, data: log }
    } catch (e) {
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ diff 조회 ============
  app.get('/projects/:id/git/diff', async (request, reply): Promise<ApiResponse<GitDiff[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const query = request.query as { file?: string; staged?: string }

    try {
      const diffs = await gitService.getDiff(
        id,
        query.file,
        query.staged === 'true',
      )
      return { success: true, data: diffs }
    } catch (e) {
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })
}
