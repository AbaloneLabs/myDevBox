/**
 * Git-Sync — external commit detection (watermark-incremental)
 *
 * For git-connected projects: fetch → count commits since the watermark →
 * diff --name-only → pull --rebase --autostash → enqueue maintenance. The
 * commit watermark (wikiSyncState.lastCommitSha) bounds the range so already-
 * processed commits are never re-handled (idempotent). Watermark advances to
 * HEAD inside maintenance's finalizeMaintenance once the tree is clean.
 */

import { simpleGit } from 'simple-git'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { projects } from '../db/schema.js'
import { expandTilde } from './path-service.js'
import { wikiService } from './wiki-service.js'
import type { SimpleGit } from 'simple-git'
import { wikiMaintenance } from './wiki-maintenance.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

async function resolveUpstream(git: SimpleGit): Promise<string | null> {
  try {
    const up = ((await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])) ?? '').trim()
    if (up) return up
  } catch { /* upstream not set */ }
  // Fallback: origin/<current-branch>
  try {
    const branch = ((await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])) ?? '').trim()
    if (branch && branch !== 'HEAD') return `origin/${branch}`
  } catch { /* detached / unborn */ }
  return null
}

class GitSync {
  private checking = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  /** Check a single project for new external commits. */
  async checkProject(projectId: string): Promise<void> {
    if (this.checking.has(projectId)) return

    const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
    if (!row || !row.gitRemoteUrl) return // git-connected projects only

    this.checking.add(projectId)
    try {
      const git = simpleGit(expandTilde(row.path))

      // 1. Fetch remote metadata only (network errors → next cycle).
      try {
        await git.fetch()
      } catch (e) {
        logger.debug({ err: e, projectId }, 'git-sync fetch failed, skipping')
        return
      }

      // 2. Resolve watermark (base) and upstream.
      const state = await wikiService.getSyncState(projectId)
      const base = state?.lastCommitSha ?? null
      const upstream = await resolveUpstream(git)
      if (!upstream) {
        logger.debug({ projectId }, 'git-sync: no upstream, skipping')
        return
      }

      // 3. Count new commits since the watermark (or HEAD if none yet).
      const range = base ? `${base}..${upstream}` : `HEAD..${upstream}`
      const countRaw = ((await git.raw(['rev-list', '--count', range])) ?? '').trim()
      const count = parseInt(countRaw, 10)
      if (!Number.isFinite(count) || count <= 0) return // nothing new → no work

      // 4. Determine changed files in that range.
      const diffOut = ((await git.raw(['diff', '--name-only', range])) ?? '').trim()
      const paths = diffOut.split('\n').map(s => s.trim()).filter(Boolean)

      logger.info({ projectId, count, upstream, base }, 'git-sync: new commits detected')

      // 5. Pull with rebase + autostash (preserve uncommitted work).
      try {
        await git.raw(['pull', '--rebase', '--autostash'])
      } catch (e) {
        logger.warn({ err: e, projectId }, 'git-sync: pull conflict, will retry next cycle')
        return
      }

      // 6. Enqueue maintenance for the changed paths. Watermark advances in
      //    finalizeMaintenance once the post-pull tree is clean.
      wikiMaintenance.enqueue(projectId, paths)
    } catch (e) {
      logger.warn({ err: e, projectId }, 'git-sync: checkProject failed')
    } finally {
      this.checking.delete(projectId)
    }
  }

  /** Check every git-connected project. */
  async checkAll(): Promise<void> {
    const rows = await db.select().from(projects)
    for (const r of rows) {
      if (r.gitRemoteUrl) void this.checkProject(r.id).catch(() => null)
    }
  }

  /** Start the periodic sync loop. Call once at server startup. */
  startScheduler(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.checkAll() }, config.gitSyncIntervalMs)
    logger.info({ intervalMs: config.gitSyncIntervalMs }, 'git-sync scheduler started')
  }
}

export const gitSync = new GitSync()
