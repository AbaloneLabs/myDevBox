/**
 * Provider Routes — 서버-레벨 LLM 프로바이더 자격증명 관리.
 * 단일 사용자 가정: isDefault=true 행을 에이전트가 사용.
 */
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import type { ApiResponse, ProviderCredential, ProviderDescriptorPublic } from '@mydevbox/shared'
import { saveProviderSchema } from '@mydevbox/shared'
import { db } from '../db/connection.js'
import { providerCredentials } from '../db/schema.js'
import { encrypt, decrypt } from '../db/crypto.js'
import { PROVIDERS, PROVIDER_BY_ID, resolveBaseUrl } from '../agent/llm/registry.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function rowToCredential(row: typeof providerCredentials.$inferSelect): ProviderCredential {
  const descriptor = PROVIDER_BY_ID[row.provider]
  return {
    id: row.id,
    provider: row.provider,
    displayName: descriptor?.displayName ?? row.provider,
    baseUrlOverride: row.baseUrlOverride ?? undefined,
    defaultModel: row.defaultModel,
    isDefault: !!row.isDefault,
    hasApiKey: !!row.apiKeyEncrypted,
  }
}

export async function providerRoutes(app: FastifyInstance): Promise<void> {
  // 사용 가능한 프로바이더 목록 (레지스트리, 시크릿 없음)
  app.get('/providers/available', async (): Promise<ApiResponse<ProviderDescriptorPublic[]>> => {
    return {
      success: true,
      data: PROVIDERS.map((d) => ({
        id: d.id,
        displayName: d.displayName,
        category: d.category,
        apiShape: d.apiShape,
        defaultBaseUrl: d.defaultBaseUrl,
        authFieldLabel: d.authFieldLabel,
        supportsDiscovery: d.supportsDiscovery,
        docsUrl: d.docsUrl,
      })),
    }
  })

  // 저장된 프로바이더 목록
  app.get('/providers', async (): Promise<ApiResponse<ProviderCredential[]>> => {
    const rows = await db.select().from(providerCredentials)
    return { success: true, data: rows.map(rowToCredential) }
  })

  // 저장 (provider 기준 upsert)
  app.post('/providers', async (request, reply): Promise<ApiResponse<ProviderCredential>> => {
    const parsed = saveProviderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: 'Validation Error',
        details: parsed.error.issues,
      })
    }
    const { provider, apiKey, baseUrlOverride, defaultModel, isDefault } = parsed.data
    if (!PROVIDER_BY_ID[provider]) {
      return reply.code(400).send({ success: false, error: `Unknown provider: ${provider}` })
    }

    // 단일 default: 새로 기본 지정 시 기존 default 해제
    if (isDefault) {
      await db.update(providerCredentials)
        .set({ isDefault: false })
        .where(eq(providerCredentials.isDefault, true))
    }

    const [existing] = await db.select().from(providerCredentials).where(eq(providerCredentials.provider, provider))
    const apiKeyEncrypted = apiKey ? encrypt(apiKey) : existing?.apiKeyEncrypted
    const row = existing
      ? (await db.update(providerCredentials).set({
          apiKeyEncrypted,
          baseUrlOverride: baseUrlOverride ?? null,
          defaultModel,
          isDefault: isDefault ?? existing.isDefault,
        }).where(eq(providerCredentials.provider, provider)).returning())[0]
      : (await db.insert(providerCredentials).values({
          provider,
          apiKeyEncrypted,
          baseUrlOverride: baseUrlOverride ?? null,
          defaultModel,
          isDefault: isDefault ?? false,
        }).returning())[0]

    return { success: true, data: rowToCredential(row) }
  })

  // 기본 프로바이더 지정
  app.patch('/providers/:id/default', async (request, reply): Promise<ApiResponse<null>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(400).send({ success: false, error: 'Invalid id' })
    }
    await db.update(providerCredentials).set({ isDefault: false }).where(eq(providerCredentials.isDefault, true))
    await db.update(providerCredentials).set({ isDefault: true }).where(eq(providerCredentials.id, id))
    return { success: true, data: null }
  })

  // 삭제
  app.delete('/providers/:id', async (request, reply): Promise<ApiResponse<null>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(400).send({ success: false, error: 'Invalid id' })
    }
    await db.delete(providerCredentials).where(eq(providerCredentials.id, id))
    return { success: true, data: null }
  })

  // 모델 디스커버리 (OpenAI-compat /v1/models)
  app.get('/providers/:id/models', async (request, reply): Promise<ApiResponse<string[]>> => {
    const { id } = request.params as { id: string }
    const [row] = await db.select().from(providerCredentials).where(eq(providerCredentials.id, id))
    if (!row) {
      return reply.code(404).send({ success: false, error: 'Provider config not found' })
    }
    const descriptor = PROVIDER_BY_ID[row.provider]
    if (!descriptor?.supportsDiscovery) {
      return { success: true, data: [] }
    }
    const baseUrl = resolveBaseUrl(descriptor, row.baseUrlOverride ?? undefined)
    if (!baseUrl) {
      return { success: true, data: [] }
    }
    const apiKey = row.apiKeyEncrypted ? decrypt(row.apiKeyEncrypted) : ''
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        return reply.code(502).send({ success: false, error: `Discovery failed: HTTP ${res.status}` })
      }
      const json = (await res.json()) as { data?: Array<{ id: string }> }
      return { success: true, data: (json.data ?? []).map((m) => m.id).filter(Boolean) }
    } catch (e) {
      return reply.code(502).send({ success: false, error: `Discovery failed: ${(e as Error).message}` })
    }
  })
}
