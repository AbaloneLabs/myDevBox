/**
 * Plan Service
 *
 * CRUD for plans. Plans are stored in DB AND written to the project's
 * plans/ directory as markdown files.
 */

import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { plans } from '../db/schema.js'
import { projects } from '../db/schema.js'
import { expandTilde } from './path-service.js'
import type { Plan } from '@mydevbox/shared'

function rowToPlan(row: typeof plans.$inferSelect): Plan {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    version: row.version,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }
}

async function getProjectPath(projectId: string): Promise<string> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!row) throw new Error('Project not found')
  return expandTilde(row.path)
}

export class PlanService {
  async list(projectId: string): Promise<Plan[]> {
    const rows = await db
      .select()
      .from(plans)
      .where(eq(plans.projectId, projectId))

    return rows
      .map(rowToPlan)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getById(planId: string): Promise<Plan | null> {
    const [row] = await db.select().from(plans).where(eq(plans.id, planId))
    return row ? rowToPlan(row) : null
  }

  async create(
    projectId: string,
    input: {
      planName: string
      version: string
      content: string
    },
  ): Promise<Plan> {
    // Generate file path: plans/{date}-{planName}-{version}.md
    const date = new Date().toISOString().split('T')[0]
    const slug = input.planName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const fileName = `${date}-${slug}-${input.version}.md`
    const relativePath = `plans/${fileName}`

    // Write to filesystem
    const projectPath = await getProjectPath(projectId)
    const plansDir = path.join(projectPath, 'plans')
    await fs.promises.mkdir(plansDir, { recursive: true })
    const fullPath = path.join(plansDir, fileName)
    await fs.promises.writeFile(fullPath, input.content, 'utf-8')

    // Store in DB
    const [row] = await db
      .insert(plans)
      .values({
        projectId,
        title: input.planName,
        version: input.version,
        filePath: relativePath,
        content: input.content,
      })
      .returning()

    return rowToPlan(row)
  }

  async update(
    planId: string,
    input: {
      title?: string
      version?: string
      content?: string
    },
  ): Promise<Plan | null> {
    const existing = await this.getById(planId)
    if (!existing) return null

    const updateData: Record<string, unknown> = {}
    if (input.title !== undefined) updateData.title = input.title
    if (input.version !== undefined) updateData.version = input.version
    if (input.content !== undefined) updateData.content = input.content

    // Update file if content changed
    if (input.content !== undefined) {
      const [row] = await db
        .select({ filePath: plans.filePath, projectId: plans.projectId })
        .from(plans)
        .where(eq(plans.id, planId))
      if (row) {
        const projectPath = await getProjectPath(row.projectId)
        const fullPath = path.join(projectPath, row.filePath)
        try {
          await fs.promises.writeFile(fullPath, input.content, 'utf-8')
        } catch {
          // File may not exist yet — create it
          await fs.promises.mkdir(path.dirname(fullPath), { recursive: true })
          await fs.promises.writeFile(fullPath, input.content, 'utf-8')
        }
      }
    }

    const [updated] = await db
      .update(plans)
      .set(updateData)
      .where(eq(plans.id, planId))
      .returning()

    return updated ? rowToPlan(updated) : null
  }

  async delete(planId: string): Promise<void> {
    // Delete file from filesystem
    const [row] = await db
      .select({ filePath: plans.filePath, projectId: plans.projectId })
      .from(plans)
      .where(eq(plans.id, planId))

    if (row) {
      const projectPath = await getProjectPath(row.projectId)
      const fullPath = path.join(projectPath, row.filePath)
      await fs.promises.unlink(fullPath).catch(() => {})
    }

    await db.delete(plans).where(eq(plans.id, planId))
  }

  async deleteAllByProject(projectId: string): Promise<void> {
    await db.delete(plans).where(eq(plans.projectId, projectId))
  }
}

export const planService = new PlanService()
