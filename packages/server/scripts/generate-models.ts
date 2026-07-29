/**
 * Model Catalog Generator
 *
 * Pulls live model metadata from the models.dev public catalog
 * (https://models.dev/api.json), filters it down to providers present in our
 * registry, and merges the result with the curated AVAILABLE_MODELS seed. The
 * merged catalog is written to src/agent/generated-models.json.
 *
 * Run: pnpm --filter @mydevbox/server exec tsx scripts/generate-models.ts
 */

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PROVIDERS } from '../src/agent/llm/registry.js'
import { AVAILABLE_MODELS } from '../src/agent/models.js'

// ============ Output Type ============

/**
 * Generated catalog entry. Mirrors ModelInfo but widens `provider` to a plain
 * string (the catalog spans the full registry, not just LLMProvider) and adds
 * an optional upstream `description`.
 */
interface GeneratedModel {
  id: string
  name: string
  provider: string
  contextWindow: number
  maxOutput: number
  supportsTools: boolean
  description?: string
}

// ============ models.dev API Types (tolerant) ============

interface ModelsDevLimit {
  context?: number
  output?: number
  input?: number
}

interface ModelsDevModel {
  id?: string
  name?: string
  description?: string
  tool_call?: boolean
  limit?: ModelsDevLimit
  // Flat-shape fallback fields (snake_case), per the documented contract.
  context_window?: number
  max_output_tokens?: number
}

interface ModelsDevProvider {
  id?: string
  name?: string
  models?: Record<string, ModelsDevModel>
}

// The real shape: an object keyed by provider id.
type ModelsDevCatalog = Record<string, ModelsDevProvider>

const API_URL = 'https://models.dev/api.json'

// ============ Provider Mapping ============

/**
 * models.dev provider id -> our registry provider id. Only providers we want to
 * enrich from upstream are listed; local/custom providers (ollama, vllm,
 * litellm, custom-openai, ...) intentionally have no static catalog and are
 * omitted.
 */
const DEV_TO_REGISTRY: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  openrouter: 'openrouter',
  groq: 'groq',
  togetherai: 'together',
  mistral: 'mistral',
  'fireworks-ai': 'fireworks',
  cerebras: 'cerebras',
  xai: 'xai',
  deepinfra: 'deepinfra',
  nvidia: 'nvidia',
  zai: 'zai',
  zhipuai: 'zai',
  moonshotai: 'kimi',
  google: 'google',
  gitlab: 'gitlab',
  'github-copilot': 'copilot',
  'amazon-bedrock': 'bedrock',
}

/** Guard against typos / stale aliases: only emit models for known registry ids. */
const VALID_REGISTRY_ID: Record<string, true> = Object.fromEntries(
  PROVIDERS.map(p => [p.id, true] as const),
)

// ============ Helpers ============

/** First strictly-positive number among the args, else 0. */
function pickPositive(...vals: Array<number | undefined>): number {
  for (const v of vals) {
    if (typeof v === 'number' && v > 0) return v
  }
  return 0
}

/** Map a single models.dev entry to our shape; null if unusable. */
function transformModel(raw: ModelsDevModel, providerId: string): GeneratedModel | null {
  const id = raw.id?.trim()
  const name = (raw.name ?? raw.id ?? '').trim()
  if (!id || !name) return null
  const limit = raw.limit ?? {}
  const contextWindow = pickPositive(limit.context, raw.context_window)
  const maxOutput = pickPositive(limit.output, raw.max_output_tokens)

  // Skip non-chat models (image/embedding/audio) with no usable context window.
  if (contextWindow === 0) return null

  const model: GeneratedModel = {
    id,
    name,
    provider: providerId,
    contextWindow,
    maxOutput,
    supportsTools: raw.tool_call ?? false,
  }
  if (raw.description) model.description = raw.description
  return model
}

// ============ Fetch ============

async function fetchCatalog(): Promise<ModelsDevCatalog> {
  const res = await fetch(API_URL)
  if (!res.ok) {
    throw new Error(`models.dev API returned ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as unknown

  // Primary shape: object keyed by provider id.
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as ModelsDevCatalog
  }
  throw new Error('Unexpected models.dev API shape (expected object keyed by provider id)')
}

// ============ Extract ============

/** Pull and map all upstream models whose provider matches our registry. */
function extractUpstream(catalog: ModelsDevCatalog): GeneratedModel[] {
  const out: GeneratedModel[] = []
  for (const [devProviderId, devProvider] of Object.entries(catalog)) {
    const registryId = DEV_TO_REGISTRY[devProviderId]
    if (!registryId || !VALID_REGISTRY_ID[registryId]) continue

    const models = devProvider?.models
    if (!models || typeof models !== 'object') continue

    for (const raw of Object.values(models)) {
      const model = transformModel(raw, registryId)
      if (model) out.push(model)
    }
  }
  return out
}

// ============ Merge ============

/**
 * Merge upstream models with the AVAILABLE_MODELS seed, deduplicating by id.
 * Upstream is authoritative; the seed fills gaps for ids upstream lacks.
 */
function mergeModels(upstream: GeneratedModel[]): {
  models: GeneratedModel[]
  upstreamCount: number
  seedCount: number
} {
  const seen = new Set<string>()
  const models: GeneratedModel[] = []

  for (const model of upstream) {
    if (!seen.has(model.id)) {
      seen.add(model.id)
      models.push(model)
    }
  }
  const upstreamCount = models.length

  for (const seed of AVAILABLE_MODELS) {
    if (seen.has(seed.id)) continue
    seen.add(seed.id)
    models.push({
      id: seed.id,
      name: seed.name,
      provider: seed.provider,
      contextWindow: seed.contextWindow,
      maxOutput: seed.maxOutput,
      supportsTools: seed.supportsTools,
    })
  }
  const seedCount = models.length - upstreamCount

  models.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
    return a.name.localeCompare(b.name)
  })

  return { models, upstreamCount, seedCount }
}

// ============ Main ============

async function main(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const outPath = resolve(__dirname, '../src/agent/generated-models.json')

  console.log(`Fetching model catalog from ${API_URL} ...`)
  const catalog = await fetchCatalog()
  const upstream = extractUpstream(catalog)
  const { models, upstreamCount, seedCount } = mergeModels(upstream)

  writeFileSync(outPath, JSON.stringify(models, null, 2) + '\n', 'utf8')

  console.log(`Model catalog generated: ${outPath}`)
  console.log(`  ${upstreamCount} from models.dev upstream`)
  console.log(`  ${seedCount} from AVAILABLE_MODELS seed (gaps filled)`)
  console.log(`  ${models.length} total models`)
}

main().catch(err => {
  console.error('Failed to generate model catalog:', err)
  process.exit(1)
})
