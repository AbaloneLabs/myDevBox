/**
 * 서버-레벨 기본 프로바이더 자격증명 → ModelConfig 변환.
 * 에이전트 실행 경로(message-handler, wiki-maintenance)가 호출.
 * 단일 사용자: isDefault=true 행을 사용, 없으면 아무 행이나 폴백.
 * OAuth 자격증명은 만료 임박 시 자동 갱신.
 */
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { providerCredentials } from '../db/schema.js'
import { decrypt, encrypt } from '../db/crypto.js'
import { PROVIDER_BY_ID, resolveBaseUrl } from './llm/registry.js'
import { OAUTH_PROVIDERS } from './oauth-registry.js'
import { refreshTokens } from './oauth.js'
import type { ModelConfig } from './types.js'

const EXPIRY_SKEW_MS = 5 * 60 * 1000

export async function getDefaultModelConfig(): Promise<ModelConfig | null> {
  const [defaultRow] = await db.select().from(providerCredentials).where(eq(providerCredentials.isDefault, true))
  const cred = defaultRow ?? (await db.select().from(providerCredentials))[0]
  if (!cred) return null

  // OAuth 자격증명: access 토큰을 Bearer로. 만료 임박 시 갱신.
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
    return {
      provider: cred.provider,
      model: cred.defaultModel,
      apiKey: accessToken,
      baseUrl: oauthConfig.apiBaseUrl,
      extraHeaders: oauthConfig.apiExtraHeaders,
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
    model: cred.defaultModel,
    apiKey: apiKey || 'local-no-key',
    baseUrl: descriptor ? resolveBaseUrl(descriptor, cred.baseUrlOverride ?? undefined) : undefined,
  }
}
