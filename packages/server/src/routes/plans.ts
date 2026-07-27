/**
 * Plans Routes
 *
 * GET    /projects/:id/plans           - list
 * GET    /projects/:id/plans/:planId   - get by id
 * POST   /projects/:id/plans           - create
 * PUT    /projects/:id/plans/:planId   - update
 * DELETE /projects/:id/plans/:planId   - delete
 */

import type { FastifyInstance } from 'fastify'
import { planService } from '../services/plan-service.js'
import { createPlanSchema, updatePlanSchema } from '@mydevbox/shared'
import type { ApiResponse, Plan } from '@mydevbox/shared'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function planRoutes(app: FastifyInstance): Promise<void> {
  // ============ 목록 조회 ============
  app.get('/projects/:id/plans', async (request): Promise<ApiResponse<Plan[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return { success: false, error: 'Invalid project ID' }
    }
    const list = await planService.list(id)
    return { success: true, data: list }
  })

  // ============ 상세 조회 ============
  app.get('/projects/:id/plans/:planId', async (request, reply): Promise<ApiResponse<Plan>> => {
    const { planId } = request.params as { planId: string }
    if (!UUID_RE.test(planId)) {
      return { success: false, error: 'Invalid plan ID' }
    }

    const plan = await planService.getById(planId)
    if (!plan) {
      reply.code(404)
      return { success: false, error: 'Plan not found' }
    }

    return { success: true, data: plan }
  })

  // ============ 생성 ============
  app.post('/projects/:id/plans', async (request, reply): Promise<ApiResponse<Plan>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return { success: false, error: 'Invalid project ID' }
    }

    const parsed = createPlanSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const plan = await planService.create(id, {
      planName: parsed.data.planName,
      version: parsed.data.version,
      content: parsed.data.content,
    })
    return { success: true, data: plan }
  })

  // ============ 수정 ============
  app.put('/projects/:id/plans/:planId', async (request, reply): Promise<ApiResponse<Plan>> => {
    const { planId } = request.params as { planId: string }
    if (!UUID_RE.test(planId)) {
      return { success: false, error: 'Invalid plan ID' }
    }

    const parsed = updatePlanSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    const plan = await planService.update(planId, parsed.data)
    if (!plan) {
      reply.code(404)
      return { success: false, error: 'Plan not found' }
    }

    return { success: true, data: plan }
  })

  // ============ 삭제 ============
  app.delete('/projects/:id/plans/:planId', async (request, reply): Promise<ApiResponse<null>> => {
    const { planId } = request.params as { planId: string }
    if (!UUID_RE.test(planId)) {
      return { success: false, error: 'Invalid plan ID' }
    }

    await planService.delete(planId)
    return { success: true, data: null }
  })
}
