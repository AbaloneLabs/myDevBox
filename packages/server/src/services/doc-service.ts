/**
 * Doc Service
 *
 * CRUD for docs. Docs are stored in DB and optionally written to
 * the project's docs/ directory. Supports scanning existing docs/ folder.
 */

import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { docs } from '../db/schema.js'
import { projects } from '../db/schema.js'
import { expandTilde } from './path-service.js'
import type { Doc } from '@mydevbox/shared'

function rowToDoc(row: typeof docs.$inferSelect): Doc {
  return {
    id: row.id,
    projectId: row.projectId,
    filePath: row.filePath,
    title: row.title,
    content: row.content,
    generatedAt: row.generatedAt.toISOString(),
  }
}

async function getProjectPath(projectId: string): Promise<string> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!row) throw new Error('Project not found')
  return expandTilde(row.path)
}

export class DocService {
  async list(projectId: string): Promise<Doc[]> {
    const rows = await db
      .select()
      .from(docs)
      .where(eq(docs.projectId, projectId))

    return rows
      .map(rowToDoc)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
  }

  async getById(docId: string): Promise<Doc | null> {
    const [row] = await db.select().from(docs).where(eq(docs.id, docId))
    return row ? rowToDoc(row) : null
  }

  async create(
    projectId: string,
    input: {
      title: string
      content: string
      filePath?: string
    },
  ): Promise<Doc> {
    // Determine file path
    const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const relativePath = input.filePath ?? `docs/${slug}.md`

    // Write to filesystem
    const projectPath = await getProjectPath(projectId)
    const fullPath = path.join(projectPath, relativePath)
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.promises.writeFile(fullPath, input.content, 'utf-8')

    // Store in DB
    const [row] = await db
      .insert(docs)
      .values({
        projectId,
        filePath: relativePath,
        title: input.title,
        content: input.content,
      })
      .returning()

    return rowToDoc(row)
  }

  async delete(docId: string): Promise<void> {
    // Delete file from filesystem
    const [row] = await db
      .select({ filePath: docs.filePath, projectId: docs.projectId })
      .from(docs)
      .where(eq(docs.id, docId))

    if (row) {
      const projectPath = await getProjectPath(row.projectId)
      const fullPath = path.join(projectPath, row.filePath)
      await fs.promises.unlink(fullPath).catch(() => {})
    }

    await db.delete(docs).where(eq(docs.id, docId))
  }

  /**
   * Scan the project's docs/ directory for existing markdown files
   * and register them in the DB if not already registered.
   */
  async scanExistingDocs(projectId: string): Promise<Doc[]> {
    const projectPath = await getProjectPath(projectId)
    const docsDir = path.join(projectPath, 'docs')

    if (!fs.existsSync(docsDir)) {
      return []
    }

    // Get already registered file paths
    const existing = await db
      .select({ filePath: docs.filePath })
      .from(docs)
      .where(eq(docs.projectId, projectId))
    const registeredPaths = new Set(existing.map((r) => r.filePath))

    // Scan docs/ directory recursively for .md files
    const newDocs: Doc[] = []
    const scanDir = (dir: string, prefix: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const relativePath = prefix ? `docs/${prefix}/${entry.name}` : `docs/${entry.name}`

        if (entry.isDirectory()) {
          scanDir(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name)
        } else if (entry.name.endsWith('.md')) {
          if (registeredPaths.has(relativePath)) continue

          try {
            const content = fs.readFileSync(fullPath, 'utf-8')
            const title = entry.name.replace(/\.md$/, '')
            newDocs.push({
              id: '', // will be filled after insert
              projectId,
              filePath: relativePath,
              title,
              content,
              generatedAt: new Date().toISOString(),
            })
          } catch {
            // Skip unreadable files
          }
        }
      }
    }

    scanDir(docsDir, '')

    // Insert newly found docs
    for (const doc of newDocs) {
      const [row] = await db
        .insert(docs)
        .values({
          projectId,
          filePath: doc.filePath,
          title: doc.title,
          content: doc.content,
        })
        .returning()
      doc.id = row.id
      doc.generatedAt = row.generatedAt.toISOString()
    }

    return newDocs
  }

  async deleteAllByProject(projectId: string): Promise<void> {
    await db.delete(docs).where(eq(docs.projectId, projectId))
  }
}

export const docService = new DocService()
