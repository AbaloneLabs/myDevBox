/**
 * 역할별 ModelConfig 해석.
 * 에이전트 실행 경로(message-handler·wiki-maintenance)가 호출.
 * 역할 매핑(model_roles) → default 역할 → isDefault 자격증명 순 폴백.
 * OAuth 자격증명은 만료 임박 시 자동 갱신.
 */
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { providerCredentials, modelRoles } from '../db/schema.js'
import { decrypt, encrypt } from '../db/crypto.js'
import { PROVIDER_BY_ID, resolveBaseUrl } from './llm/registry.js'
import { OAUTH_PROVIDERS } from './oauth-registry.js'
import { refreshTokens } from './oauth.js'
import type { ModelConfig } from './types.js'

const EXPIRY_SKEW_MS = 5 * 60 * 1000

/** credential 행 + 모델 → ModelConfig. OAuth면 만료 임박 시 갱신. */
async function buildModelConfig(
  cred: typeof providerCredentials.$inferSelect,
  model: string,
): Promise<ModelConfig> {
  const oauthConfig = cred.oauthAccessTokenEncrypted ? OAUTH_PROVIDERS[cred.provider] : undefined
  if (cred.oauthAccessTokenEncrypted && oauthConfig) {
    const refreshToken = cred.oauthRefreshTokenEncrypted ? decrypt(cred.oauthRefreshTokenEncrypted) : undefined
    let accessToken = decrypt(cred.oauthAccessTokenEncrypted)
    const expired = cred.oauthExpiresAt ? cred.oauthExpiresAt.getTime() - Date.now() < EXPIRY_SKEW_MS : false
    if (expired && refreshToken) {
      try {
        const refreshed = await refreshTokens(oauthConfig, refreshToken)
        accessToken = refreshed.accessToken
        await db.update(providerCredentials).set({
          oauthAccessTokenEncrypted: encrypt(refreshed.accessToken),
          oauthRefreshTokenEncrypted: refreshed.refreshToken ? encrypt(refreshed.refreshToken) : cred.oauthRefreshTokenEncrypted,
          oauthExpiresAt: refreshed.expiresAt ? new Date(refreshed.expiresAt) : null,
        }).where(eq(providerCredentials.id, cred.id))
      } catch {
        // 갱신 실패 시 기존 토큰으로 진행 — 프로바이더가 거부하면 런타임 에러로 드러남.
      }
    }
    // Anthropic OAuth는 Bearer(SDK authToken) + anthropic-beta 헤더. 그 외 OpenAI-compat는 Bearer.
    const isAnthropic = cred.provider === 'anthropic'
    return {
      provider: cred.provider,
      model,
      apiKey: accessToken,
      baseUrl: oauthConfig.apiBaseUrl,
      authMode: isAnthropic ? 'bearer' : undefined,
      extraHeaders: isAnthropic
        ? { 'anthropic-beta': 'oauth-2025-04-20', ...(oauthConfig.apiExtraHeaders ?? {}) }
        : oauthConfig.apiExtraHeaders,
    }
  }

  // API 키 자격증명
  const descriptor = PROVIDER_BY_ID[cred.provider]
  let apiKey = ''
  if (cred.apiKeyEncrypted) {
    try {
      apiKey = decrypt(cred.apiKeyEncrypted)
    } catch {
      apiKey = ''
    }
  }
  // 로컬 서버(llama.cpp/ollama 등)는 키가 없어도 동작 — OpenAI SDK는 빈 키면 에러므로 placeholder.
  return {
    provider: cred.provider,
    model,
    apiKey: apiKey || 'local-no-key',
    baseUrl: descriptor ? resolveBaseUrl(descriptor, cred.baseUrlOverride ?? undefined) : undefined,
  }
}

async function findCredential(id: string) {
  const [row] = await db.select().from(providerCredentials).where(eq(providerCredentials.id, id))
  return row
}

async function findDefaultCredential() {
  const [def] = await db.select().from(providerCredentials).where(eq(providerCredentials.isDefault, true))
  if (def) return def
  const [any] = await db.select().from(providerCredentials)
  return any
}

/**
 * 역할에 해당하는 ModelConfig.
 * 폴백: 역할 매핑 → (role≠default면) default 매핑 → isDefault 자격증명.
 */
export async function getModelConfigForRole(role = 'default'): Promise<ModelConfig | null> {
  const [roleRow] = await db.select().from(modelRoles).where(eq(modelRoles.role, role))
  if (roleRow?.credentialId) {
    const cred = await findCredential(roleRow.credentialId)
    if (cred) return buildModelConfig(cred, roleRow.model)
  }
  if (role !== 'default') {
    const [defRole] = await db.select().from(modelRoles).where(eq(modelRoles.role, 'default'))
    if (defRole?.credentialId) {
      const cred = await findCredential(defRole.credentialId)
      if (cred) return buildModelConfig(cred, defRole.model)
    }
  }
  const cred = await findDefaultCredential()
  if (!cred) return null
  return buildModelConfig(cred, cred.defaultModel)
}

/** 기본 역할의 ModelConfig (하위 호환 — message-handler/wiki-maintenance가 사용). */
export async function getDefaultModelConfig(): Promise<ModelConfig | null> {
  return getModelConfigForRole('default')
}
