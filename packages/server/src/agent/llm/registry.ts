/**
 * Provider Descriptor Registry
 *
 * 한 프로바이더당 하나의 descriptor. 정적 models.ts + getProvider 스위치를 대체하는 기반.
 * "프로바이더 추가 = descriptor 한 줄 추가"가 목표.
 *
 * 영감: omp의 CATALOG_PROVIDERS (opensource/oh-my-pi/packages/catalog) —
 * 구조/이름은 우리 설계로 재구현 (omp 코드 아님).
 *
 * Phase 1: api-key / openai-compat 카테고리 중심.
 * Phase 3에서 oauth/cloud descriptor가 채워진다.
 */

// ============ Categories & API Shapes ============

export type ProviderCategory = 'api-key' | 'openai-compat' | 'oauth' | 'cloud'

/**
 * 어댑터를 고르는 기준. 각 shape은 packages/server/src/agent/llm/<shape>.ts 어댑터와 1:1.
 * Phase 1은 anthropic-messages / openai-completions 두 shape만 라우팅에 사용.
 */
export type ApiShape =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses' // Phase 4
  | 'google-generative' // Phase 4
  | 'bedrock-converse' // Phase 4
  | 'ollama-chat' // openai-completions으로 커버 가능하지만 별도 표기

// ============ Descriptor ============

export interface ProviderDescriptor {
  /** 고유 id. ModelConfig.provider 및 저장 스키마와 일치. */
  id: string
  displayName: string
  category: ProviderCategory
  /** 이 프로바이저를 호출할 어댑터. */
  apiShape: ApiShape
  /**
   * 고정 엔드포인트가 있으면 명시. 없으면(커스텀) 사용자가 baseUrl을 제공.
   * getProvider는 이 값을 ModelConfig.baseUrl의 기본으로 사용한다.
   */
  defaultBaseUrl?: string
  /** 자격증명 입력 UI 라벨 (예: "Anthropic API Key"). */
  authFieldLabel?: string
  /** /v1/models (또는 동등) 으로 모델 목록을 발견할 수 있으면 true. */
  supportsDiscovery?: boolean
  docsUrl?: string
  /** OAuth 프로바이더의 인증 플로우 식별자 (Phase 3). */
  oauthFlow?: string
}

// ============ Catalog ============

export const PROVIDERS: readonly ProviderDescriptor[] = [
  // --- API key (직접 API) ---
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    category: 'api-key',
    apiShape: 'anthropic-messages',
    authFieldLabel: 'Anthropic API Key',
    supportsDiscovery: false,
    docsUrl: 'https://docs.anthropic.com',
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    category: 'api-key',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'https://api.openai.com/v1',
    authFieldLabel: 'OpenAI API Key',
    supportsDiscovery: true,
    docsUrl: 'https://platform.openai.com',
  },

  // --- OpenAI-compat (동일 openai-completions 어댑터, baseUrl만 다름) ---
  // 이 그룹이 "최대한 많은 프로바이더"를 한 번에 커버한다.
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    authFieldLabel: 'OpenRouter API Key',
    supportsDiscovery: true,
  },
  {
    id: 'groq',
    displayName: 'Groq',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    authFieldLabel: 'Groq API Key',
    supportsDiscovery: true,
  },
  {
    id: 'together',
    displayName: 'Together AI',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    authFieldLabel: 'Together API Key',
    supportsDiscovery: true,
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    authFieldLabel: 'Mistral API Key',
    supportsDiscovery: true,
  },
  {
    id: 'fireworks',
    displayName: 'Fireworks AI',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    authFieldLabel: 'Fireworks API Key',
    supportsDiscovery: true,
  },
  {
    id: 'cerebras',
    displayName: 'Cerebras',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    authFieldLabel: 'Cerebras API Key',
    supportsDiscovery: true,
  },
  {
    id: 'xai',
    displayName: 'xAI (Grok)',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'https://api.x.ai/v1',
    authFieldLabel: 'xAI API Key',
    supportsDiscovery: true,
  },
  {
    id: 'deepinfra',
    displayName: 'DeepInfra',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
    authFieldLabel: 'DeepInfra API Key',
    supportsDiscovery: true,
  },
  {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    authFieldLabel: 'NVIDIA API Key',
    supportsDiscovery: true,
  },

  // --- Self-hosted (OpenAI-compat, 로컬/사용자 엔드포인트) ---
  {
    id: 'ollama',
    displayName: 'Ollama (local)',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'http://localhost:11434/v1',
    supportsDiscovery: true,
  },
  {
    id: 'lmstudio',
    displayName: 'LM Studio (local)',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    defaultBaseUrl: 'http://localhost:1234/v1',
    supportsDiscovery: true,
  },
  {
    id: 'vllm',
    displayName: 'vLLM (custom endpoint)',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    supportsDiscovery: true,
  },
  {
    id: 'litellm',
    displayName: 'LiteLLM (custom endpoint)',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    supportsDiscovery: true,
  },

  // --- 임의의 OpenAI-compat 엔드포인트 ---
  {
    id: 'custom-openai',
    displayName: 'Custom (OpenAI-compatible)',
    category: 'openai-compat',
    apiShape: 'openai-completions',
    supportsDiscovery: true,
  },

  // --- OAuth / Cloud (Phase 3 — placeholder; 라우팅에는 아직 미사용) ---
  {
    id: 'google',
    displayName: 'Google Gemini',
    category: 'oauth',
    apiShape: 'google-generative',
    supportsDiscovery: true,
    docsUrl: 'https://ai.google.dev',
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    category: 'oauth',
    apiShape: 'openai-completions',
    supportsDiscovery: true,
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    category: 'oauth',
    apiShape: 'openai-completions',
    supportsDiscovery: true,
  },
  {
    id: 'gitlab',
    displayName: 'GitLab Duo',
    category: 'oauth',
    apiShape: 'openai-completions',
    supportsDiscovery: true,
  },
  {
    id: 'bedrock',
    displayName: 'AWS Bedrock',
    category: 'cloud',
    apiShape: 'bedrock-converse',
    supportsDiscovery: true,
  },
] as const

// ============ Lookup ============

/**
 * id → descriptor 정적 조회 테이블. (정적이므로 Map이 아닌 Record.)
 * 사용처는 PROVIDER_BY_ID[providerId] 로 직접 조회한다.
 */
export const PROVIDER_BY_ID: Record<string, ProviderDescriptor> = Object.fromEntries(
  PROVIDERS.map(p => [p.id, p] as const),
)

/**
 * 실제 호출에 쓸 baseUrl.
 * 사용자가(저장 설정에서) baseUrl을 제공하면 그것이 우선, 없으면 descriptor 기본값.
 * 이 우선순위 + trim 처리는 인라인하면 의도가 안 보이므로 이름을 둔다.
 */
export function resolveBaseUrl(
  descriptor: ProviderDescriptor,
  userBaseUrl?: string,
): string | undefined {
  return userBaseUrl?.trim() || descriptor.defaultBaseUrl
}
