import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/connection.js'
import type { ApiResponse } from '@mydevbox/shared'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<ApiResponse<{ status: string; db: string }>> => {
    let dbStatus = 'connected'

    try {
      await db.execute(sql`SELECT 1`)
    } catch {
      dbStatus = 'disconnected'
    }

    return {
      success: true,
      data: {
        status: 'ok',
        db: dbStatus,
      },
    }
  })
}
