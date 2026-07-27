/**
 * Wiki Scheduler — consolidates all periodic background jobs:
 *   - git-sync loop            (config.gitSyncIntervalMs, ~5 min)
 *   - master aggregation loop  (config.masterSyncIntervalMs, ~2 h)
 *   - weekly wiki_lint         (all projects, fix=true)
 *   - monthly forced full master aggregation
 *
 * Call startWikiSchedulers() once at server startup.
 */

import { db } from '../db/connection.js'
import { projects } from '../db/schema.js'
import { lintWiki } from './wiki-lint.js'
import { aggregateMasterWiki, startMasterAggregationScheduler } from './wiki-aggregation.js'
import { gitSync } from './git-sync.js'
import { logger } from '../logger.js'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MONTH_MS = 30 * 24 * 60 * 60 * 1000
// Node's setInterval delay is a 32-bit signed int (max ~24.8 days), so the
// monthly job uses a 1-day heartbeat and checks elapsed time instead.
const DAY_MS = 24 * 60 * 60 * 1000

let lintTimer: NodeJS.Timeout | null = null
let monthTimer: NodeJS.Timeout | null = null
let lastMonthlyRun = 0

/** Run wiki_lint (fix=true) across every project. */
async function lintAllProjects(): Promise<void> {
  const rows = await db.select().from(projects)
  for (const r of rows) {
    try {
      await lintWiki(r.id, { fix: true })
    } catch (e) {
      logger.warn({ err: e, projectId: r.id }, 'scheduled wiki_lint failed')
    }
  }
}

/** Start every periodic wiki job. Idempotent. */
export function startWikiSchedulers(): void {
  gitSync.startScheduler()
  startMasterAggregationScheduler()

  if (!lintTimer) {
    lintTimer = setInterval(() => { void lintAllProjects() }, WEEK_MS)
    logger.info({ intervalMs: WEEK_MS }, 'weekly wiki_lint scheduler started')
  }
  if (!monthTimer) {
    lastMonthlyRun = Date.now()
    monthTimer = setInterval(() => {
      if (Date.now() - lastMonthlyRun >= MONTH_MS) {
        lastMonthlyRun = Date.now()
        void aggregateMasterWiki()
      }
    }, DAY_MS)
    logger.info({ intervalMs: MONTH_MS }, 'monthly master-aggregation scheduler started (1-day heartbeat)')
  }
}
