/**
 * Tasks Routes
 *
 * GET    /projects/:id/tasks           - list
 * POST   /projects/:id/tasks           - create
 * PUT    /projects/:id/tasks/:taskId   - update
 * DELETE /projects/:id/tasks/:taskId   - delete
 */

import type { FastifyInstance } from 'fastify'
import { taskService } from '../services/task-service.js'
import { createTaskSchema, updateTaskSchema } from '@mydevbox/shared'
import type { ApiResponse, Task } from '@mydevbox/shared'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // ============ 목록 조회 ============
  app.get('/projects/:id/tasks', async (request): Promise<ApiResponse<Task[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return { success: false, error: 'Invalid project ID' }
    }
    const list = await taskService.list(id)
    return { success: true, data: list }
  })

  // ============ 생성 ============
  app.post('/projects/:id/tasks', async (request, reply): Promise<ApiResponse<Task>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return { success: false, error: 'Invalid project ID' }
    }

    const parsed = createTaskSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const task = await taskService.create(id, parsed.data)
    return { success: true, data: task }
  })

  // ============ 수정 ============
  app.put('/projects/:id/tasks/:taskId', async (request, reply): Promise<ApiResponse<Task>> => {
    const { id, taskId } = request.params as { id: string; taskId: string }
    if (!UUID_RE.test(taskId)) {
      return { success: false, error: 'Invalid task ID' }
    }

    const parsed = updateTaskSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const task = await taskService.update(taskId, parsed.data)
    if (!task) {
      reply.code(404)
      return { success: false, error: 'Task not found' }
    }

    return { success: true, data: task }
  })

  // ============ 삭제 ============
  app.delete('/projects/:id/tasks/:taskId', async (request, reply): Promise<ApiResponse<null>> => {
    const { taskId } = request.params as { taskId: string }
    if (!UUID_RE.test(taskId)) {
      return { success: false, error: 'Invalid task ID' }
    }

    await taskService.delete(taskId)
    return { success: true, data: null }
  })
}
