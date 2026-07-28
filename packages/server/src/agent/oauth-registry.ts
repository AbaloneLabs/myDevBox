/**
 * 프로바이더별 OAuth 설정.
 * omp의 registry/oauth/ 값을 참조해 재구현 (omp 코드 아님). client_id/엔드포인트/scope는 사실 정보.
 *
 * API 호출이 OpenAI-compat + Bearer로 깔끔한: xAI, Kimi, Copilot.
 * Anthropic/Codex는 토큰 획득까지만 지원 (특수 헤더/엔드포인트는 별도 어댑터 작업 필요).
 * Cursor/Devin(protobuf), Google(프로비저닝), GitLab(2단계 게이트웨이) = 추후.
 */
import type { OAuthFlowConfig } from './oauth.js'

const KIMI_HEADERS: Record<string, string> = {
  'User-Agent': 'MyDevBox/0.1',
  'X-Msh-Platform': 'kimi_cli',
  'X-Msh-Version': '0.1.0',
  'X-Msh-Device-Name': 'mydevbox',
  'X-Msh-Device-Model': 'server',
  'X-Msh-Os-Version': 'linux',
  'X-Msh-Device-Id': 'mydevbox-0001',
}

export const OAUTH_PROVIDERS: Record<string, OAuthFlowConfig> = {
  copilot: {
    provider: 'copilot',
    displayName: 'GitHub Copilot',
    flowType: 'device-code',
    clientId: 'Ov23li8tweQw6odWQebz',
    deviceCodeUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['read:user'],
    extraTokenHeaders: { Accept: 'application/json' },
    apiBaseUrl: 'https://api.githubcopilot.com',
    apiExtraHeaders: {
      'User-Agent': 'MyDevBox/0.1',
      'X-GitHub-Api-Version': '2026-06-01',
    },
    apiDefaultModel: 'gpt-4o',
  } as OAuthFlowConfig & { apiDefaultModel: string },

  kimi: {
    provider: 'kimi',
    displayName: 'Kimi (Moonshot)',
    flowType: 'device-code',
    clientId: '17e5f671-d194-4dfb-9706-5516cb48c098',
    deviceCodeUrl: 'https://auth.kimi.com/api/oauth/device_authorization',
    tokenUrl: 'https://auth.kimi.com/api/oauth/token',
    scopes: [],
    extraTokenHeaders: KIMI_HEADERS,
    apiBaseUrl: 'https://api.kimi.com/coding/v1',
    apiExtraHeaders: KIMI_HEADERS,
    apiDefaultModel: 'kimi-k2-instruct',
  } as OAuthFlowConfig & { apiDefaultModel: string },

  xai: {
    provider: 'xai',
    displayName: 'xAI (Grok)',
    flowType: 'device-code',
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    deviceCodeUrl: 'https://auth.x.ai/oauth2/device/code',
    tokenUrl: 'https://auth.x.ai/oauth2/token',
    scopes: ['openid', 'profile', 'email', 'offline_access', 'grok-cli:access', 'api:access'],
    apiBaseUrl: 'https://api.x.ai/v1',
    apiDefaultModel: 'grok-4',
  } as OAuthFlowConfig & { apiDefaultModel: string },

  anthropic: {
    provider: 'anthropic',
    displayName: 'Anthropic (Claude)',
    flowType: 'pkce-auth-code',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://api.anthropic.com/v1/oauth/token',
    scopes: ['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code', 'user:mcp_servers', 'user:file_upload'],
    extraTokenHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
    // API 사용: Anthropic 어댑터 + anthropic-version/beta 헤더 — 별도 어댑터 작업 필요.
  },

  'openai-codex': {
    provider: 'openai-codex',
    displayName: 'OpenAI Codex (ChatGPT)',
    flowType: 'pkce-auth-code',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    scopes: ['openid', 'profile', 'email', 'offline_access', 'api.connectors.read', 'api.connectors.invoke'],
    extraAuthParams: {
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'mydevbox',
    },
    // API 사용: chatgpt.com/backend-api/codex/responses — 별도 엔드포인트/헤더 작업 필요.
  },
}

/** OAuth 가능 프로바이저 id 목록 (UI용). */
export const OAUTH_PROVIDER_IDS = Object.keys(OAUTH_PROVIDERS)
