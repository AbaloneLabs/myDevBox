/**
 * Master Wiki Aggregation (cross-project)
 *
 * Reads each project flagged in `syncNeeded`, runs a headless agent that
 * queries the project's wiki and writes cross-project master pages
 * (projectId IS NULL): project_summary, patterns, learnings, conventions,
 * technical_debt. Clears the flags and logs a master 'sync' entry afterward.
 */

import { db } from '../db/connection.js'
import { syncNeeded } from '../db/schema.js'
import { wikiService } from './wiki-service.js'
import { runHeadlessWikiAgent } from './wiki-maintenance.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

const AGGREGATION_PROMPT = `You are updating the CROSS-PROJECT MASTER WIKI based on a single source project.

1. Call wiki_query (scope='project') for wiki/index.md, wiki/architecture.md, and wiki/decisions.md to understand THIS project.
2. Then update the master wiki — IMPORTANT: pass scope='master' on EVERY wiki_write so the pages land in the cross-project master wiki (not this project). Update:
   - wiki/project_summary.md: a "## <ProjectName>" section with stack, purpose, key modules. Add or refresh this project's section (keep other projects' sections intact).
   - wiki/patterns.md: recurring architectural patterns observed across projects.
   - wiki/learnings.md: gotchas and insights worth remembering across projects.
   - wiki/conventions.md: coding and style conventions.
   - wiki/technical_debt.md: notable debt items, with the owning project named.

Use [[wikilinks]] to cross-reference. Keep every claim grounded in the project wiki content you actually read via wiki_query. First wiki_read the existing master page (scope='master') before writing, so you preserve other projects' content.`

let aggregating = false
let timer: NodeJS.Timeout | null = null

/** Aggregate flagged projects into the master wiki. Idempotent via `aggregating` flag. */
export async function aggregateMasterWiki(): Promise<{ count: number }> {
  if (aggregating) {
    logger.info('master aggregation already running, skipping')
    return { count: 0 }
  }

  const flagged = await db.select().from(syncNeeded)
  if (flagged.length === 0) {
    logger.info('no projects flagged for master aggregation')
    return { count: 0 }
  }

  aggregating = true
  try {
    logger.info({ count: flagged.length }, 'master aggregation starting')
    for (const f of flagged) {
      try {
        await runHeadlessWikiAgent(f.projectId, AGGREGATION_PROMPT, 15)
      } catch (e) {
        logger.error({ err: e, projectId: f.projectId }, 'master aggregation: per-project run failed')
      }
    }

    await db.delete(syncNeeded)
    await wikiService.appendLog(null, 'sync',
      `Aggregated master wiki from ${flagged.length} project(s)`,
      { count: flagged.length, projects: flagged.map(f => f.projectId) })
    logger.info({ count: flagged.length }, 'master aggregation complete')
    return { count: flagged.length }
  } finally {
    aggregating = false
  }
}

/** Start the periodic master-aggregation loop. Call once at server startup. */
export function startMasterAggregationScheduler(): void {
  if (timer) return
  timer = setInterval(() => { void aggregateMasterWiki() }, config.masterSyncIntervalMs)
  logger.info({ intervalMs: config.masterSyncIntervalMs }, 'master aggregation scheduler started')
}
