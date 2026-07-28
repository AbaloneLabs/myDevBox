/**
 * LLM 프로바이더 OAuth 플로우 (프로바이더 무관 유틸).
 *
 * 두 가지 플로우를 지원:
 *  - device-code: 사용자가 URL 가서 코드 입력 → 서버가 폴링. 콜백/redirect-URI 불필요 (웹에 깔끔).
 *  - pkce-auth-code: 프로바이저로 리다이렉트 → 콜백 회수.
 *
 * omp의 registry/oauth/ 패턴을 참조해 우리 식으로 재구현 (omp 코드 아님).
 * 프로바이더별 구체값(client_id/URL/scope)은 oauth-registry.ts에 둔다.
 */
import crypto from 'node:crypto'

// ============ 타입 ============

export type OAuthFlowType = 'device-code' | 'pkce-auth-code'

/** 프로바이더별 OAuth 설정. oauth-registry.ts의 각 엔트리가 이 형태. */
export interface OAuthFlowConfig {
  provider: string
  flowType: OAuthFlowType
  clientId: string
  clientSecret?: string
  /** device-code: 디바이스 코드 발급(및 폴링) 엔드포인트. */
  deviceCodeUrl?: string
  /** pkce: authorize 엔드포인트. */
  authorizeUrl?: string
  tokenUrl: string
  scopes: string[]
  /** authorize 요청에 추가로 필요한 프로바이저 고유 파라미터. */
  extraAuthParams?: Record<string, string>
  /** 토큰 교환/갱신(및 디바이스 요청) 시 추가 헤더. */
  extraTokenHeaders?: Record<string, string>
  /** 토큰 획득 후 LLM API 호출 base URL (OpenAI-compat인 경우). */
  apiBaseUrl?: string
  /** LLM API 호출 시 추가 헤더 (예: Copilot X-GitHub-Api-Version, Kimi X-Msh-*). */
  apiExtraHeaders?: Record<string, string>
  /** displayName (UI용). */
  displayName?: string
  /** OAuth 성공 시 기본 모델 (사용자가 설정에서 변경 가능). */
  apiDefaultModel?: string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  /** epoch ms. 만료 임박 시 갱신. */
  expiresAt?: number
  tokenType?: string
}

export interface DeviceCodeInfo {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

// ============ PKCE (S256) ============

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=$/, '')
}

/** PKCE verifier(무작위) + challenge = BASE64URL(SHA256(verifier)). */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** pkce authorize URL 생성. */
export function buildAuthorizeUrl(
  config: OAuthFlowConfig,
  args: { redirectUri: string; state: string; challenge: string },
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: args.redirectUri,
    scope: config.scopes.join(' '),
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: 'S256',
    ...(config.extraAuthParams ?? {}),
  })
  return `${config.authorizeUrl}?${params.toString()}`
}

// ============ 공통 토큰 요청 ============

function tokenHeaders(config: OAuthFlowConfig): Record<string, string> {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    ...(config.extraTokenHeaders ?? {}),
  }
}

function parseTokenResponse(json: Record<string, unknown>): OAuthTokens {
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: json.expires_in ? Date.now() + Number(json.expires_in) * 1000 : undefined,
    tokenType: json.token_type ? String(json.token_type) : undefined,
  }
}

// ============ Device-code 플로우 ============

const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

/** 디바이스 코드 발급. 사용자가 verificationUri 가서 userCode 입력. */
export async function requestDeviceCode(config: OAuthFlowConfig): Promise<DeviceCodeInfo> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    ...(config.scopes.length ? { scope: config.scopes.join(' ') } : {}),
  })
  const res = await fetch(config.deviceCodeUrl!, {
    method: 'POST',
    headers: tokenHeaders(config),
    body,
    signal: AbortSignal.timeout(15000),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`device code request failed: HTTP ${res.status} ${JSON.stringify(json)}`)
  }
  return {
    deviceCode: String(json.device_code),
    userCode: String(json.user_code),
    verificationUri: String(json.verification_uri ?? json.verification_url ?? ''),
    expiresIn: Number(json.expires_in ?? 900),
    interval: Number(json.interval ?? 5),
  }
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'success'; tokens: OAuthTokens }
  | { status: 'error'; error: string }

/** 디바이스 코드 폴링 1회 시도. 호출측이 interval마다 재호출. */
export async function pollDeviceCode(config: OAuthFlowConfig, deviceCode: string): Promise<DevicePollResult> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    device_code: deviceCode,
    grant_type: DEVICE_CODE_GRANT,
    ...(config.scopes.length ? { scope: config.scopes.join(' ') } : {}),
  })
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: tokenHeaders(config),
    body,
    signal: AbortSignal.timeout(15000),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (res.ok) {
    return { status: 'success', tokens: parseTokenResponse(json) }
  }
  const err = String(json.error ?? '')
  if (err === 'authorization_pending' || err === 'slow_down') {
    return { status: 'pending' }
  }
  return { status: 'error', error: err || `HTTP ${res.status}` }
}

// ============ PKCE 토큰 교환/갱신 ============

/** 인증 코드 → 토큰 교환 (pkce). */
export async function exchangeAuthCode(
  config: OAuthFlowConfig,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
  })
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: tokenHeaders(config),
    body,
    signal: AbortSignal.timeout(15000),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`token exchange failed: HTTP ${res.status} ${JSON.stringify(json)}`)
  }
  return parseTokenResponse(json)
}

/** 만료된 access token 갱신. (device-code/pkce 공통) */
export async function refreshTokens(config: OAuthFlowConfig, refreshToken: string): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
  })
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: tokenHeaders(config),
    body,
    signal: AbortSignal.timeout(15000),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`token refresh failed: HTTP ${res.status} ${JSON.stringify(json)}`)
  }
  const tokens = parseTokenResponse(json)
  // 일부 프로바이저는 갱신 응답에 refresh_token을 안 줌 → 기존 것 유지.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
}
