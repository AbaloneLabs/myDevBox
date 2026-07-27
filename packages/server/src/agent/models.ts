/**
 * Available LLM Models Catalog
 */

import type { ModelInfo } from '@mydevbox/shared'

export const AVAILABLE_MODELS: ModelInfo[] = [
  // Anthropic
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutput: 16384,
    supportsTools: true,
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutput: 16384,
    supportsTools: true,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutput: 8192,
    supportsTools: true,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutput: 8192,
    supportsTools: true,
  },
  // OpenAI
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsTools: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsTools: true,
  },
  {
    id: 'o3',
    name: 'o3',
    provider: 'openai',
    contextWindow: 200000,
    maxOutput: 100000,
    supportsTools: true,
  },
]

export function getModelsByProvider(provider: string): ModelInfo[] {
  return AVAILABLE_MODELS.filter(m => m.provider === provider)
}

export function findModel(modelId: string): ModelInfo | undefined {
  return AVAILABLE_MODELS.find(m => m.id === modelId)
}
