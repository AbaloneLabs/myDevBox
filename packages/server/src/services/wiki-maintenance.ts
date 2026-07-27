/**
 * Wiki Auto-Maintenance
 *
 * Three triggers all funnel into a headless agent run with a restricted tool
 * set [read, grep, find, ls, wiki_query, wiki_write]:
 *   - bootstrapWiki(projectId)     : first-open, empty wiki → 5-step seed run
 *   - WikiMaintenanceQueue.enqueue : debounced file-change maintenance
 *   - GitSync.checkProject         : external git commits (watermark-incremental)
 *
 * Concurrency: a per-project `Set` serializes runs. provider/apiKey missing →
 * skip + log. Commit watermark (wikiSyncState) advances to HEAD only when the
 * working tree is clean (finalizeMaintenance), except bootstrap which sets HEAD
 * directly.
 */

import { simpleGit } from 'simple-git'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { projects, agentConfigs, syncNeeded } from '../db/schema.js'
import { decrypt } from '../db/crypto.js'
import { expandTilde } from './path-service.js'
import { wikiService } from './wiki-service.js'
import { logger } from '../logger.js'
import {
  runAgentLoop, getProvider, buildSystemPrompt,
} from '../agent/index.js'
import { createReadOnlyTools, createDbWikiTools } from '../agent/tools/index.js'
import type {
  AgentContext, AgentLoopConfig, AgentTool, ModelConfig, AgentEvent,
} from '../agent/types.js'

// Per-project serialization: at most one maintenance/bootstrap run at a time.
const runningProjects = new Set<string>()

// ============ Provider / tools for headless runs ============

async function getProject(projectId: string): Promise<{ id: string; name: string; path: string; gitRemoteUrl: string | null }> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!row) throw new Error(`Project not found: ${projectId}`)
  return {
    id: row.id, name: row.name, path: expandTilde(row.path),
    gitRemoteUrl: row.gitRemoteUrl ?? null,
  }
}

/** Load + decrypt the agent model config. Returns null if no usable API key. */
async function getMaintenanceProvider(projectId: string): Promise<ModelConfig | null> {
  const [configRow] = await db.select().from(agentConfigs).where(eq(agentConfigs.projectId, projectId))
  const provider = (configRow?.provider as 'openai' | 'anthropic') ?? 'anthropic'
  const model = configRow?.model ?? 'claude-sonnet-4-20250514'
  const temperature = configRow?.temperature ?? 0.7
  const maxTokens = configRow?.maxTokens ?? 8192

  let apiKey = ''
  if (configRow?.apiKeyEncrypted) {
    try { apiKey = decrypt(configRow.apiKeyEncrypted) } catch { apiKey = '' }
  }
  if (!apiKey) return null
  return { provider, model, temperature, maxTokens, apiKey }
}

/** Restricted, side-effect-free (except wiki) tool set for background runs. */
function buildMaintenanceTools(projectId: string, projectPath: string): AgentTool[] {
  const readonly = createReadOnlyTools(projectPath)
  const wiki = createDbWikiTools(projectId)
    .filter(t => t.name === 'wiki_query' || t.name === 'wiki_write')
  return [...readonly, ...wiki]
}

/** Run a headless agent turn with the maintenance tool set. Exported for master aggregation. */
export async function runHeadlessWikiAgent(
  projectId: string,
  prompt: string,
  maxTurns: number,
): Promise<void> {
  const modelConfig = await getMaintenanceProvider(projectId)
  if (!modelConfig) {
    logger.warn({ projectId }, 'wiki maintenance skipped: no API key configured')
    return
  }
  const project = await getProject(projectId)
  const tools = buildMaintenanceTools(projectId, project.path)
  const systemPrompt = buildSystemPrompt({
    projectName: project.name,
    projectPath: project.path,
    tools: [],
    wikiPreamble: 'You are running as a background wiki-maintenance agent. Keep every claim grounded in actual source code you read — never invent facts.',
  })

  const context: AgentContext = {
    systemPrompt,
    messages: [],
    tools,
    model: modelConfig,
  }
  const provider = getProvider(modelConfig)
  const loopConfig: AgentLoopConfig = {
    model: modelConfig,
    maxTurns,
    toolExecution: 'parallel',
  }
  const emit = async (_event: AgentEvent): Promise<void> => { /* headless: no UI */ }

  await runAgentLoop(prompt, context, loopConfig, provider, emit)
}

// ============ Commit watermark ============

/**
 * Advance the watermark to HEAD only if the working tree is clean
 * (uncommitted internal changes do not advance the watermark — see plan 5.2/5.4).
 */
export async function finalizeMaintenance(projectId: string): Promise<void> {
  try {
    const project = await getProject(projectId)
    const git = simpleGit(project.path)
    const porcelain = ((await git.raw(['status', '--porcelain'])) ?? '').trim()
    if (porcelain === '') {
      const head = ((await git.raw(['rev-parse', 'HEAD'])) ?? '').trim()
      if (head) await wikiService.setSyncState(projectId, head)
    }
  } catch {
    // not a git repo or no commits yet — nothing to watermark
  }
}

// ============ 5.1 Bootstrap ============

const BOOTSTRAP_PROMPT = `Bootstrap the project wiki from scratch. Work methodically through these steps, writing each page with the wiki_write tool. Keep every statement grounded in files you actually read.

0. Detect the stack from root manifests (package.json, go.mod, Cargo.toml, pyproject.toml, Gemfile, etc.).
1. DATA MODEL: read db/schema files, migrations/, models/ or prisma/schema. Write wiki/data-model.md (overview) and wiki/models/<entity>.md per entity (fields, relations, invariants). Use git log -- <schema/migration path> to note recent schema changes.
2. API / ARCHITECTURE: read routes/, controllers/, handlers/, resolvers/. Write wiki/routes.md (endpoints), wiki/architecture.md (layers + data flow), wiki/decisions.md (ADRs inferred from git log --grep="refactor|migrate|architecture|design"), and wiki/dependencies.md (key libraries + their role).
3. GAPS: note anything unclear, TODO/FIXME density, missing tests, or risky areas in wiki/gaps.md.
4. INDEX + LOG: write wiki/index.md (a table of contents linking [[data-model]], [[routes]], [[architecture]], [[decisions]], [[dependencies]], [[gaps]] with a one-line summary each) and wiki/log.md (markdown changelog seeded with this bootstrap).

Use [[wikilinks]] to cross-reference pages. Be concise and factual.`

export async function bootstrapWiki(projectId: string): Promise<void> {
  if (runningProjects.has(projectId)) {
    logger.info({ projectId }, 'wiki bootstrap skipped: another run in progress')
    return
  }
  runningProjects.add(projectId)
  try {
    const project = await getProject(projectId)
    logger.info({ projectId, name: project.name }, 'wiki bootstrap starting')
    await runHeadlessWikiAgent(projectId, BOOTSTRAP_PROMPT, 30)

    // Bootstrap is a complete seed run → watermark to current HEAD directly
    // (the wiki/ files it wrote are intentionally uncommitted).
    try {
      const git = simpleGit(project.path)
      const head = ((await git.raw(['rev-parse', 'HEAD'])) ?? '').trim()
      if (head) await wikiService.setSyncState(projectId, head)
    } catch { /* non-git */ }

    await wikiService.appendLog(projectId, 'bootstrap', `Bootstrapped wiki for ${project.name}`, {})
    logger.info({ projectId }, 'wiki bootstrap complete')
  } catch (e) {
    logger.error({ err: e, projectId }, 'wiki bootstrap failed')
  } finally {
    runningProjects.delete(projectId)
  }
}

// ============ 5.2 File-change maintenance queue ============

const CLASS_PATTERNS: Array<[string, RegExp]> = [
  ['data-model', /(db\/schema|migrations\/|models\/|entities\/|prisma\/schema|schema\.rb)/],
  ['routes', /(routes|controllers\/|handlers\/|endpoints\/|resolvers\/)/],
  ['deps', /(Gemfile|package\.json|go\.mod|Cargo\.toml|requirements\.txt|pyproject\.toml|composer\.json)/],
  ['plans', /^(plans|todos|docs)\//],
]

function classifyPaths(paths: string[]): Set<string> {
  const classes = new Set<string>()
  for (const p of paths) {
    for (const [cls, re] of CLASS_PATTERNS) {
      if (re.test(p)) classes.add(cls)
    }
  }
  return classes
}

function buildMaintenancePrompt(classes: Set<string>, paths: string[]): string {
  return `Files changed (classes: ${[...classes].join(', ')}). Affected paths:\n${paths.map(p => `- ${p}`).join('\n')}

Read the relevant source files, then update the matching wiki pages so they reflect the current code:
${[...classes].map(c => {
  if (c === 'data-model') return '- data-model → wiki/data-model.md and the relevant wiki/models/<entity>.md'
  if (c === 'routes') return '- routes → wiki/routes.md and wiki/architecture.md'
  if (c === 'deps') return '- deps → wiki/dependencies.md'
  if (c === 'plans') return '- plans → wiki/index.md roadmap section'
  return ''
}).join('\n')}

Call wiki_query first to see existing content, then wiki_write to update. Keep every claim grounded in actual code you read. Append a one-line entry to wiki/log.md summarizing this maintenance.`
}

async function upsertSyncNeeded(projectId: string, reason: string): Promise<void> {
  const [existing] = await db.select().from(syncNeeded).where(eq(syncNeeded.projectId, projectId))
  if (existing) {
    await db.update(syncNeeded).set({ flaggedAt: new Date(), reason })
      .where(eq(syncNeeded.projectId, projectId))
  } else {
    await db.insert(syncNeeded).values({ projectId, reason })
  }
}

class WikiMaintenanceQueue {
  private timers = new Map<string, NodeJS.Timeout>()
  private pending = new Map<string, string[]>()
  private readonly debounceMs = 8000

  /** Enqueue changed paths for a project. wiki/ paths are ignored (recursion guard). */
  enqueue(projectId: string, changedPaths: string[]): void {
    const filtered = changedPaths.filter(p => !p.startsWith('wiki/'))
    if (filtered.length === 0) return

    const acc = this.pending.get(projectId) ?? []
    for (const p of filtered) if (!acc.includes(p)) acc.push(p)
    this.pending.set(projectId, acc)

    clearTimeout(this.timers.get(projectId) ?? undefined)
    this.timers.set(projectId, setTimeout(() => { void this.flush(projectId) }, this.debounceMs))
  }

  private async flush(projectId: string): Promise<void> {
    this.timers.delete(projectId)
    const paths = this.pending.get(projectId) ?? []
    this.pending.delete(projectId)
    if (paths.length === 0) return

    // If a run is in progress, defer by re-enqueuing.
    if (runningProjects.has(projectId)) {
      this.pending.set(projectId, paths)
      this.timers.set(projectId, setTimeout(() => { void this.flush(projectId) }, this.debounceMs))
      return
    }

    const classes = classifyPaths(paths)
    if (classes.size === 0) return

    runningProjects.add(projectId)
    try {
      const prompt = buildMaintenancePrompt(classes, paths)
      await runHeadlessWikiAgent(projectId, prompt, 12)
      await wikiService.appendLog(projectId, 'maintenance',
        `Maintained ${[...classes].join(', ')} (${paths.length} file(s))`,
        { classes: [...classes], paths })
      await upsertSyncNeeded(projectId, [...classes].join(','))
      await finalizeMaintenance(projectId)
    } catch (e) {
      logger.error({ err: e, projectId }, 'wiki maintenance failed')
    } finally {
      runningProjects.delete(projectId)
    }
  }
}

export const wikiMaintenance = new WikiMaintenanceQueue()

