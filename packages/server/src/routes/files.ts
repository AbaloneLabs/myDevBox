import type { FastifyInstance } from 'fastify'
import { fileService } from '../services/file-service.js'
import { PathTraversalError } from '../services/path-service.js'
import {
  writeFileSchema,
  renameFileSchema,
  mkdirSchema,
} from '@mydevbox/shared'
import type { ApiResponse, FileNode, FileContent, SearchResult } from '@mydevbox/shared'

// UUID 형식 검증
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 에러에서 statusCode 추출 (기본 500)
 */
function getStatusCode(e: unknown): number {
  const err = e as Error & { statusCode?: number }
  return err.statusCode ?? 500
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  // ============ 디렉토리 트리 조회 ============
  app.get('/projects/:id/tree', async (request, reply): Promise<ApiResponse<FileNode[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const query = request.query as {
      path?: string
      depth?: string
      showHidden?: string
    }

    try {
      const tree = await fileService.getTree(
        id,
        query.path ?? '.',
        query.depth ? parseInt(query.depth, 10) : 10,
        query.showHidden === 'true',
      )
      return { success: true, data: tree }
    } catch (e) {
      if (e instanceof PathTraversalError) {
        return reply.code(403).send({ success: false, error: (e as Error).message })
      }
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ 파일 검색 (트리/파일 라우트보다 먼저 등록하여 충돌 회피) ============
  app.get('/projects/:id/files/search', async (request, reply): Promise<ApiResponse<SearchResult>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const query = request.query as {
      pattern?: string
      glob?: string
      outputMode?: string
      context?: string
    }

    if (!query.pattern) {
      return reply.code(400).send({ success: false, error: 'pattern query parameter is required' })
    }

    try {
      const result = await fileService.search(
        id,
        query.pattern,
        query.glob,
        (query.outputMode as 'content' | 'files_with_matches' | 'count') ?? 'files_with_matches',
        query.context ? parseInt(query.context, 10) : 0,
      )
      return { success: true, data: result }
    } catch (e) {
      if (e instanceof PathTraversalError) {
        return reply.code(403).send({ success: false, error: (e as Error).message })
      }
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ 파일 내용 읽기 ============
  app.get('/projects/:id/files', async (request, reply): Promise<ApiResponse<FileContent>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const query = request.query as {
      path?: string
      startLine?: string
      endLine?: string
    }

    if (!query.path) {
      return reply.code(400).send({ success: false, error: 'path query parameter is required' })
    }

    try {
      const content = await fileService.readFile(
        id,
        query.path,
        query.startLine ? parseInt(query.startLine, 10) : undefined,
        query.endLine ? parseInt(query.endLine, 10) : undefined,
      )
      return { success: true, data: content }
    } catch (e) {
      if (e instanceof PathTraversalError) {
        return reply.code(403).send({ success: false, error: (e as Error).message })
      }
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ 파일 쓰기 ============
  app.put('/projects/:id/files', async (request, reply): Promise<ApiResponse<FileContent>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const parsed = writeFileSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Validation Error',
        details: parsed.error.issues,
      })
    }

    try {
      const content = await fileService.writeFile(
        id,
        parsed.data.path,
        parsed.data.content,
        parsed.data.overwrite,
      )
      return { success: true, data: content }
    } catch (e) {
      if (e instanceof PathTraversalError) {
        return reply.code(403).send({ success: false, error: (e as Error).message })
      }
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ 파일 삭제 ============
  app.delete('/projects/:id/files', async (request, reply): Promise<ApiResponse<null>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const query = request.query as { path?: string }
    if (!query.path) {
      return reply.code(400).send({ success: false, error: 'path query parameter is required' })
    }

    try {
      await fileService.deleteFile(id, query.path)
      return { success: true }
    } catch (e) {
      if (e instanceof PathTraversalError) {
        return reply.code(403).send({ success: false, error: (e as Error).message })
      }
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ 파일/폴더 이름 변경 ============
  app.post('/projects/:id/files/rename', async (request, reply): Promise<ApiResponse<FileNode>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const parsed = renameFileSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Validation Error',
        details: parsed.error.issues,
      })
    }

    try {
      const node = await fileService.rename(id, parsed.data.oldPath, parsed.data.newPath)
      return { success: true, data: node }
    } catch (e) {
      if (e instanceof PathTraversalError) {
        return reply.code(403).send({ success: false, error: (e as Error).message })
      }
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })

  // ============ 디렉토리 생성 ============
  app.post('/projects/:id/files/mkdir', async (request, reply): Promise<ApiResponse<FileNode>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(404).send({ success: false, error: `Project not found: ${id}` })
    }

    const parsed = mkdirSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Validation Error',
        details: parsed.error.issues,
      })
    }

    try {
      const node = await fileService.mkdir(id, parsed.data.path)
      return { success: true, data: node }
    } catch (e) {
      if (e instanceof PathTraversalError) {
        return reply.code(403).send({ success: false, error: (e as Error).message })
      }
      return reply.code(getStatusCode(e)).send({ success: false, error: (e as Error).message })
    }
  })
}
