/**
 * Provider Routes — 서버-레벨 LLM 프로바이더 자격증명 관리.
 * 단일 사용자 가정: isDefault=true 행을 에이전트가 사용.
 */
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import type { ApiResponse, ProviderCredential, ProviderDescriptorPublic, ModelRoleMapping } from '@mydevbox/shared'
import { saveProviderSchema, saveRoleMappingsSchema, discoverTransientSchema } from '@mydevbox/shared'
import { db } from '../db/connection.js'
import { providerCredentials, modelRoles } from '../db/schema.js'
import { encrypt, decrypt } from '../db/crypto.js'
import { PROVIDERS, PROVIDER_BY_ID, resolveBaseUrl } from '../agent/llm/registry.js'
import { OAUTH_PROVIDERS } from '../agent/oauth-registry.js'

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
    authType: row.oauthAccessTokenEncrypted ? 'oauth' : 'apikey',
    cachedModels: row.cachedModels ?? undefined,
  }
}

/**
 * 통합 모델 디스커버리 — OAuth 토큰이면 그걸 Bearer로(apiBaseUrl+apiExtraHeaders),
 * API키면 그걸로(PROVIDER baseUrl). 성공 시 DB에 캐싱, 실패 시 기존 캐시 유지.
 * storeOAuthTokens / POST /providers / GET /:id/models 가 호출.
 */
export async function discoverAndCacheModels(credId: string): Promise<string[]> {
  const [cred] = await db.select().from(providerCredentials).where(eq(providerCredentials.id, credId))
  if (!cred) return []
  const oauthConfig = cred.oauthAccessTokenEncrypted ? OAUTH_PROVIDERS[cred.provider] : undefined
  let baseUrl: string | undefined
  let bearer = ''
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (cred.oauthAccessTokenEncrypted && oauthConfig) {
    baseUrl = oauthConfig.apiBaseUrl
    try { bearer = decrypt(cred.oauthAccessTokenEncrypted) } catch { bearer = '' }
    Object.assign(headers, oauthConfig.apiExtraHeaders ?? {})
  } else {
    const descriptor = PROVIDER_BY_ID[cred.provider]
    baseUrl = descriptor ? resolveBaseUrl(descriptor, cred.baseUrlOverride ?? undefined) : undefined
    if (cred.apiKeyEncrypted) { try { bearer = decrypt(cred.apiKeyEncrypted) } catch { bearer = '' } }
  }
  if (baseUrl) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: { ...headers, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ id: string }> }
        const models = (json.data ?? []).map((m) => m.id).filter(Boolean)
        await db.update(providerCredentials)
          .set({ cachedModels: models, modelsCachedAt: new Date() })
          .where(eq(providerCredentials.id, credId))
        return models
      }
    } catch {
      // 일시적 실패 — 기존 캐시 유지
    }
  }
  return cred.cachedModels ?? []
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

    // 저장(또는 갱신) 직후 모델 디스커버리 (best-effort, 캐싱)
    await discoverAndCacheModels(row.id).catch(() => {})

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

  // 모델 디스커버리 (통합 — OAuth 토큰/API키 모두) + 캐싱
  app.get('/providers/:id/models', async (request, reply): Promise<ApiResponse<string[]>> => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) {
      return reply.code(400).send({ success: false, error: 'Invalid id' })
    }
    const models = await discoverAndCacheModels(id)
    return { success: true, data: models }
  })

  // 저장 전 모델 디스커버리 (입력한 provider+키+baseUrl로 /models 호출, 저장 안 함)
  app.post('/providers/discover', async (request, reply): Promise<ApiResponse<string[]>> => {
    const parsed = discoverTransientSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Validation Error', details: parsed.error.issues })
    }
    const { provider, apiKey, baseUrlOverride } = parsed.data
    const descriptor = PROVIDER_BY_ID[provider]
    const baseUrl = descriptor ? resolveBaseUrl(descriptor, baseUrlOverride ?? undefined) : (baseUrlOverride ?? undefined)
    if (!baseUrl) {
      return { success: true, data: [] }
    }
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
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

  // 역할별 모델 라우팅
  app.get('/providers/roles', async (): Promise<ApiResponse<ModelRoleMapping[]>> => {
    const roleRows = await db.select().from(modelRoles)
    const creds = await db.select().from(providerCredentials)
    const credById = new Map(creds.map((c) => [c.id, c]))
    const data: ModelRoleMapping[] = roleRows.map((r) => {
      const c = r.credentialId ? credById.get(r.credentialId) : undefined
      const descriptor = c ? PROVIDER_BY_ID[c.provider] : undefined
      return {
        role: r.role as ModelRoleMapping['role'],
        credentialId: r.credentialId ?? '',
        model: r.model,
        provider: c?.provider ?? '',
        displayName: descriptor?.displayName ?? c?.provider ?? '',
      }
    })
    return { success: true, data }
  })

  app.put('/providers/roles', async (request, reply): Promise<ApiResponse<null>> => {
    const parsed = saveRoleMappingsSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Validation Error', details: parsed.error.issues })
    }
    for (const r of parsed.data.roles) {
      const [existing] = await db.select().from(modelRoles).where(eq(modelRoles.role, r.role))
      if (existing) {
        await db.update(modelRoles).set({ credentialId: r.credentialId, model: r.model }).where(eq(modelRoles.role, r.role))
      } else {
        await db.insert(modelRoles).values({ role: r.role, credentialId: r.credentialId, model: r.model })
      }
    }
    return { success: true, data: null }
  })
}
