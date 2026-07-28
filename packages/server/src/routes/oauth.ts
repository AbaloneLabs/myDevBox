/**
 * OAuth Routes — 디바이스 코드(Copilot/Kimi/xAI) + PKCE(Anthropic/Codex) 토큰 획득.
 * 단일 사용자: 프로바이저당 진행 중 플로우 1개(메모리). 토큰 획득 시 provider_credentials에 암호화 저장.
 *
 * PKCE 콜백은 MYDEVBOX_PUBLIC_URL(예: http://host:35001)이 설정되어야 동작.
 * 디바이스 코드는 콜백/redirect-URI 불필요.
 */
import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { providerCredentials } from '../db/schema.js'
import { encrypt } from '../db/crypto.js'
import { OAUTH_PROVIDERS } from '../agent/oauth-registry.js'
import {
  generatePKCE,
  buildAuthorizeUrl,
  requestDeviceCode,
  pollDeviceCode,
  exchangeAuthCode,
  type OAuthFlowConfig,
  type OAuthTokens,
} from '../agent/oauth.js'

const CALLBACK_BASE = process.env.MYDEVBOX_PUBLIC_URL ?? ''

interface PendingDevice {
  deviceCode: string
  expiresAt: number
}
const pendingDevice = new Map<string, PendingDevice>()
interface PendingPkce {
  provider: string
  verifier: string
  expiresAt: number
}
const pendingPkce = new Map<string, PendingPkce>()

function publicCallbackUrl(provider: string): string {
  return `${CALLBACK_BASE}/api/oauth/${provider}/callback`
}

function defaultModelOf(config: OAuthFlowConfig): string {
  return config.apiDefaultModel ?? 'default'
}

/** 토큰 획득 성공 → provider_credentials upsert. 첫 프로바이저면 isDefault. */
async function storeOAuthTokens(provider: string, tokens: OAuthTokens, defaultModel: string): Promise<void> {
  const [existing] = await db.select().from(providerCredentials).where(eq(providerCredentials.provider, provider))
  const alreadyConfigured = existing ? true : (await db.select().from(providerCredentials)).length > 0
  const patch = {
    provider,
    apiKeyEncrypted: null,
    oauthAccessTokenEncrypted: encrypt(tokens.accessToken),
    oauthRefreshTokenEncrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    oauthExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
    defaultModel,
    isDefault: existing?.isDefault ?? !alreadyConfigured,
  }
  if (existing) {
    await db.update(providerCredentials).set(patch).where(eq(providerCredentials.id, existing.id))
  } else {
    await db.insert(providerCredentials).values({ ...patch, baseUrlOverride: null })
  }
}

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  // OAuth 가능 프로바이저 목록 (UI용)
  app.get('/providers/oauth/available', async () => {
    return {
      success: true,
      data: Object.values(OAUTH_PROVIDERS).map((c) => ({
        provider: c.provider,
        displayName: c.displayName ?? c.provider,
        flowType: c.flowType,
      })),
    }
  })
  // OAuth 시작
  app.post('/providers/oauth/:provider/start', async (request, reply) => {
    const config = OAUTH_PROVIDERS[(request.params as { provider: string }).provider]
    if (!config) {
      return reply.code(404).send({ success: false, error: 'Unknown OAuth provider' })
    }
    try {
      if (config.flowType === 'device-code') {
        const info = await requestDeviceCode(config)
        pendingDevice.set(config.provider, {
          deviceCode: info.deviceCode,
          expiresAt: Date.now() + info.expiresIn * 1000,
        })
        return {
          success: true,
          data: {
            flowType: 'device-code',
            userCode: info.userCode,
            verificationUri: info.verificationUri,
            interval: info.interval,
          },
        }
      }
      const pkce = await generatePKCE()
      const state = crypto.randomUUID()
      pendingPkce.set(state, { provider: config.provider, verifier: pkce.verifier, expiresAt: Date.now() + 300_000 })
      const authorizeUrl = buildAuthorizeUrl(config, {
        redirectUri: publicCallbackUrl(config.provider),
        state,
        challenge: pkce.challenge,
      })
      return { success: true, data: { flowType: 'pkce', authorizeUrl } }
    } catch (e) {
      return reply.code(502).send({ success: false, error: `OAuth start failed: ${(e as Error).message}` })
    }
  })

  // device-code 폴링 (브라우저가 interval마다 호출)
  app.post('/providers/oauth/:provider/poll', async (request, reply) => {
    const config = OAUTH_PROVIDERS[(request.params as { provider: string }).provider]
    if (!config) {
      return reply.code(404).send({ success: false, error: 'Unknown OAuth provider' })
    }
    const pending = pendingDevice.get(config.provider)
    if (!pending) {
      return reply.code(400).send({ success: false, error: 'No pending device flow — start again' })
    }
    const result = await pollDeviceCode(config, pending.deviceCode)
    if (result.status === 'pending') {
      return { success: true, data: { status: 'pending' } }
    }
    if (result.status === 'error') {
      pendingDevice.delete(config.provider)
      return { success: true, data: { status: 'error', error: result.error } }
    }
    pendingDevice.delete(config.provider)
    await storeOAuthTokens(config.provider, result.tokens, defaultModelOf(config))
    return { success: true, data: { status: 'success' } }
  })

  // pkce 콜백 (프로바이저가 리다이렉트)
  app.get('/oauth/:provider/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string }
    const pending = state ? pendingPkce.get(state) : undefined
    if (!pending || !code || !state) {
      return reply.type('text/html').send('<h1>OAuth 실패</h1>유효하지 않은 콜백입니다.')
    }
    const config = OAUTH_PROVIDERS[pending.provider]
    if (!config) {
      return reply.type('text/html').send('<h1>OAuth 실패</h1>알 수 없는 프로바이저입니다.')
    }
    pendingPkce.delete(state)
    try {
      const tokens = await exchangeAuthCode(config, code, pending.verifier, publicCallbackUrl(pending.provider))
      await storeOAuthTokens(pending.provider, tokens, defaultModelOf(config))
      return reply.type('text/html').send('<h1>OAuth 완료</h1>이 창을 닫고 MyDevBox로 돌아가세요.')
    } catch (e) {
      return reply.type('text/html').send(`<h1>OAuth 실패</h1>${(e as Error).message}`)
    }
  })
}
