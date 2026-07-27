/**
 * Agent Routes
 *
 * REST endpoints for agent configuration, model catalog, and message history.
 * Real-time agent execution (streaming) is handled via WebSocket (Plan 7).
 *
 * Based on pi's approach (opensource/pi/packages/agent/src/agent.ts)
 */

import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import type { AgentConfig, ModelInfo } from '@mydevbox/shared'
import { updateAgentConfigSchema } from '@mydevbox/shared'
import { db } from '../db/connection.js'
import { agentConfigs, chatMessages } from '../db/schema.js'
import { encrypt, decrypt } from '../db/crypto.js'
import { AVAILABLE_MODELS } from '../agent/models.js'
import { sessionRegistry } from '../agent/session.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id)
}

/**
 * Convert a DB agent_configs row to an AgentConfig (API response).
 * The API key is never returned - only hasApiKey flag.
 */
function rowToAgentConfig(
  projectId: string,
  row: typeof agentConfigs.$inferSelect | undefined,
): AgentConfig {
  return {
    projectId,
    provider: (row?.provider as 'openai' | 'anthropic') ?? 'anthropic',
    model: row?.model ?? 'claude-sonnet-4-20250514',
    temperature: row?.temperature ?? 0.7,
    maxTokens: row?.maxTokens ?? 8192,
    hasApiKey: !!row?.apiKeyEncrypted,
  }
}

/**
 * Convert a DB chat_messages row to an AgentMessage (API response).
 */
function rowToMessage(row: typeof chatMessages.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    role: row.role,
    content: row.content,
    fileChanges: row.fileChanges as unknown,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // ============ Model Catalog ============

  /**
   * GET /agent/models
   * Returns all available LLM models.
   */
  app.get('/agent/models', async (_req, reply) => {
    const models: ModelInfo[] = AVAILABLE_MODELS
    return reply.send({ success: true, data: models })
  })

  // ============ Agent Config ============

  /**
   * GET /projects/:id/agent/config
   * Returns the agent configuration for a project.
   */
  app.get('/projects/:id/agent/config', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!isValidUUID(id)) {
      return reply.code(404).send({ success: false, error: 'Project not found' })
    }

    const [row] = await db
      .select()
      .from(agentConfigs)
      .where(eq(agentConfigs.projectId, id))
      .limit(1)

    return reply.send({ success: true, data: rowToAgentConfig(id, row) })
  })

  /**
   * PUT /projects/:id/agent/config
   * Updates the agent configuration for a project.
   * API key is encrypted before storage.
   */
  app.put('/projects/:id/agent/config', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!isValidUUID(id)) {
      return reply.code(404).send({ success: false, error: 'Project not found' })
    }

    const parsed = updateAgentConfigSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: parsed.error.issues.map(i => i.message).join(', '),
      })
    }

    const input = parsed.data

    // Check if config exists
    const [existing] = await db
      .select()
      .from(agentConfigs)
      .where(eq(agentConfigs.projectId, id))
      .limit(1)

    // Build update values
    const updateValues: Record<string, unknown> = {}

    if (input.provider !== undefined) updateValues.provider = input.provider
    if (input.model !== undefined) updateValues.model = input.model
    if (input.temperature !== undefined) updateValues.temperature = input.temperature
    if (input.maxTokens !== undefined) updateValues.maxTokens = input.maxTokens

    // API key: encrypt before storing
    if (input.apiKey !== undefined) {
      if (input.apiKey === '') {
        // Empty string = clear the key
        updateValues.apiKeyEncrypted = null
      } else {
        updateValues.apiKeyEncrypted = encrypt(input.apiKey)
      }
    }

    if (existing) {
      // Update existing config
      if (Object.keys(updateValues).length > 0) {
        await db
          .update(agentConfigs)
          .set(updateValues)
          .where(eq(agentConfigs.projectId, id))
      }
    } else {
      // Insert new config
      await db
        .insert(agentConfigs)
        .values({
          projectId: id,
          provider: (updateValues.provider as string) ?? 'anthropic',
          model: (updateValues.model as string) ?? 'claude-sonnet-4-20250514',
          temperature: (updateValues.temperature as number) ?? 0.7,
          maxTokens: (updateValues.maxTokens as number) ?? 8192,
          apiKeyEncrypted: (updateValues.apiKeyEncrypted as string | null) ?? null,
        })
    }

    // Fetch the updated row
    const [row] = await db
      .select()
      .from(agentConfigs)
      .where(eq(agentConfigs.projectId, id))
      .limit(1)

    return reply.send({ success: true, data: rowToAgentConfig(id, row) })
  })

  // ============ Message History ============

  /**
   * GET /projects/:id/agent/messages
   * Returns chat message history for a project.
   */
  app.get('/projects/:id/agent/messages', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!isValidUUID(id)) {
      return reply.code(404).send({ success: false, error: 'Project not found' })
    }

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.projectId, id))

    // Sort by createdAt ascending (oldest first)
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    const messages = rows.map(rowToMessage)
    return reply.send({ success: true, data: messages })
  })

  /**
   * DELETE /projects/:id/agent/messages
   * Clears all chat messages for a project.
   */
  app.delete('/projects/:id/agent/messages', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!isValidUUID(id)) {
      return reply.code(404).send({ success: false, error: 'Project not found' })
    }

    await db
      .delete(chatMessages)
      .where(eq(chatMessages.projectId, id))

    // Also clear the in-memory session
    sessionRegistry.delete(id)

    return reply.send({ success: true, data: { cleared: true } })
  })

  // ============ Agent Control ============

  /**
   * POST /projects/:id/agent/abort
   * Aborts the currently running agent session for a project.
   */
  app.post('/projects/:id/agent/abort', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!isValidUUID(id)) {
      return reply.code(404).send({ success: false, error: 'Project not found' })
    }

    const session = sessionRegistry.get(id)
    if (!session) {
      return reply.code(404).send({ success: false, error: 'No active agent session' })
    }

    if (!session.isStreaming) {
      return reply.code(400).send({ success: false, error: 'Agent is not currently running' })
    }

    session.abort()
    return reply.send({ success: true, data: { aborted: true } })
  })

  /**
   * GET /projects/:id/agent/status
   * Returns the current status of the agent session.
   */
  app.get('/projects/:id/agent/status', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!isValidUUID(id)) {
      return reply.code(404).send({ success: false, error: 'Project not found' })
    }

    const session = sessionRegistry.get(id)
    return reply.send({
      success: true,
      data: {
        active: !!session,
        isStreaming: session?.isStreaming ?? false,
      },
    })
  })
}
