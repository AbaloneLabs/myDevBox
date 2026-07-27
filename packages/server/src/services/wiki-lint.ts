/**
 * Wiki Lint — 3-tier audit (Astro-Han + Karpathy).
 *
 *   Safe Fixes     : index↔page consistency, broken [[wikilinks]] (applied in a
 *                    transaction when fix=true; otherwise reported).
 *   Mechanical     : sha freshness (recompute git hash-object of cited source),
 *                    vanished frontmatter.source paths → mark status='outdated'.
 *   Judgment       : orphan pages / stale claims surfaced as prompts for the
 *                    LLM (the agent reasons over this report; the tool itself
 *                    does not call an LLM).
 *
 * Reused by the wiki_lint agent tool and the weekly scheduler.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { eq, and, isNull, isNotNull } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { wikiPages } from '../db/schema.js'
import { projects } from '../db/schema.js'
import { expandTilde } from './path-service.js'
import { wikiService } from './wiki-service.js'
import type { WikiPage } from '@mydevbox/shared'

export interface LintReport {
  safeFixes: string[]
  mechanical: string[]
  judgment: string[]
  checked: number
}

const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g

function basename(p: string): string {
  return p.replace(/\.md$/i, '').split('/').pop() ?? p
}

/** Compute a git blob SHA1 (git hash-object) for content. */
function gitBlobHash(content: string): string {
  return createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex')
}

async function getProjectPath(projectId: string): Promise<string | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
  return row ? expandTilde(row.path) : null
}

/** Lint a scope (projectId=null → master). Applies safe fixes when fix=true. */
export async function lintWiki(
  projectId: string | null,
  opts: { fix?: boolean } = {},
): Promise<LintReport> {
  const fix = opts.fix ?? false
  const report: LintReport = { safeFixes: [], mechanical: [], judgment: [], checked: 0 }

  const pages = await wikiService.list(projectId)
  report.checked = pages.length
  if (pages.length === 0) return report

  const byPath = new Map(pages.map(p => [p.path, p]))
  const byBasename = new Map<string, WikiPage>()
  for (const p of pages) byBasename.set(basename(p.path), p)

  const projectRoot = projectId ? await getProjectPath(projectId) : null

  // ============ Safe Fixes: index ↔ pages ============
  const index = pages.find(p => p.path === 'wiki/index.md')

  if (index) {
    const referenced = [...index.content.matchAll(WIKILINK_RE)].map(m => m[1].trim())
    const referencedSet = new Set(referenced)

    // Real pages missing from the index → add a stub line.
    const unindexed = pages.filter(p => p.path !== 'wiki/index.md' && !referencedSet.has(basename(p.path)))
    for (const p of unindexed) {
      if (fix) {
        const addition = `\n- [[${basename(p.path)}]] (no summary)`
        await wikiService.upsert(projectId, {
          path: index.path, title: index.title, content: index.content + addition, type: 'index',
        })
        report.safeFixes.push(`Added [[${basename(p.path)}]] to index.md`)
      } else {
        report.safeFixes.push(`index.md missing entry for ${p.path}`)
      }
    }

    // Index entries pointing at no page → mark [MISSING].
    for (const ref of referencedSet) {
      if (!byBasename.has(ref) && !byPath.has(ref)) {
        report.safeFixes.push(`index.md references [[${ref}]] but no page exists [MISSING]`)
      }
    }
  }

  // ============ Safe Fixes: broken [[wikilinks]] across pages ============
  const nameIndex = new Map<string, string>() // lowercased basename → path
  for (const p of pages) nameIndex.set(basename(p.path).toLowerCase(), p.path)

  for (const page of pages) {
    const links = [...page.content.matchAll(WIKILINK_RE)].map(m => ({ raw: m[0], target: m[1].trim() }))
    for (const { raw, target } of links) {
      if (byBasename.has(target) || byPath.has(target)) continue
      // Try a case-insensitive single match → repair.
      const resolved = nameIndex.get(target.toLowerCase())
      if (resolved && fix) {
        const correct = basename(resolved)
        const fixed = page.content.split(raw).join(`[[${correct}]]`)
        await wikiService.upsert(projectId, {
          path: page.path, title: page.title, content: fixed, type: page.type,
        })
        report.safeFixes.push(`Repaired ${page.path}: ${raw} → [[${correct}]]`)
      } else if (resolved) {
        report.safeFixes.push(`${page.path}: ${raw} → suggest [[${basename(resolved)}]]`)
      } else {
        report.safeFixes.push(`${page.path}: broken ${raw}`)
      }
    }
  }

  // ============ Mechanical: sha freshness + vanished sources ============
  for (const page of pages) {
    const fm = page.frontmatter ?? {}
    const source = typeof fm.source === 'string' ? fm.source : undefined
    const sha = typeof fm.sha === 'string' ? fm.sha : undefined

    if (sha && source && projectRoot) {
      const srcPath = path.join(projectRoot, source)
      try {
        const content = await fs.promises.readFile(srcPath, 'utf-8')
        const current = gitBlobHash(content)
        if (current !== sha) {
          if (fix) {
            await db.update(wikiPages).set({ status: 'outdated', updatedAt: new Date() })
              .where(eq(wikiPages.id, page.id))
          }
          report.mechanical.push(`${page.path}: source ${source} changed (sha ${sha.slice(0, 8)} → ${current.slice(0, 8)}) → outdated`)
        }
      } catch {
        report.mechanical.push(`${page.path}: frontmatter.source ${source} no longer exists`)
      }
    } else if (source && projectRoot) {
      const srcPath = path.join(projectRoot, source)
      try {
        await fs.promises.access(srcPath)
      } catch {
        report.mechanical.push(`${page.path}: frontmatter.source ${source} missing`)
      }
    }
  }

  // ============ Judgment candidates (for the LLM to reason over) ============
  // Orphan pages: nothing links to them.
  const linkedBasenames = new Set<string>()
  for (const page of pages) {
    for (const m of page.content.matchAll(WIKILINK_RE)) linkedBasenames.add(m[1].trim())
  }
  for (const page of pages) {
    if (page.path === 'wiki/index.md') continue
    if (!linkedBasenames.has(basename(page.path))) {
      report.judgment.push(`${page.path} is an orphan (no inbound [[links]]) — relevant or stale?`)
    }
  }

  await wikiService.appendLog(projectId, 'lint',
    report.safeFixes.length + report.mechanical.length === 0
      ? `Lint clean (${report.checked} pages).`
      : `Lint: ${report.safeFixes.length} fix(es), ${report.mechanical.length} mechanical, ${report.judgment.length} judgment.`,
    { fix, ...report })

  return report
}
