/**
 * Task Service
 *
 * CRUD + upsertByContent for agent todo_write tool.
 * Tasks are sorted by status (in_progress → pending → completed) then priority.
 */

import { eq, and } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { tasks } from '../db/schema.js'
import type { Task, TaskStatus, TaskPriority } from '@mydevbox/shared'

function rowToTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description ?? undefined,
    status: (row.status ?? 'pending') as TaskStatus,
    priority: (row.priority ?? 'medium') as TaskPriority,
    createdAt: row.createdAt.toISOString(),
  }
}

export class TaskService {
  /**
   * List tasks for a project, sorted by status then priority.
   */
  async list(projectId: string): Promise<Task[]> {
    const rows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))

    const statusOrder: Record<string, number> = {
      in_progress: 0,
      pending: 1,
      completed: 2,
    }
    const priorityOrder: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
    }

    return rows
      .map(rowToTask)
      .sort((a, b) => {
        const sDiff = (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3)
        if (sDiff !== 0) return sDiff
        const pDiff = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)
        if (pDiff !== 0) return pDiff
        return a.createdAt.localeCompare(b.createdAt)
      })
  }

  async getById(taskId: string): Promise<Task | null> {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId))
    return row ? rowToTask(row) : null
  }

  async create(
    projectId: string,
    input: {
      title: string
      description?: string
      status?: string
      priority?: string
    },
  ): Promise<Task> {
    const [row] = await db
      .insert(tasks)
      .values({
        projectId,
        title: input.title,
        description: input.description,
        status: input.status ?? 'pending',
        priority: input.priority ?? 'medium',
      })
      .returning()

    return rowToTask(row)
  }

  async update(
    taskId: string,
    input: {
      title?: string
      description?: string
      status?: string
      priority?: string
    },
  ): Promise<Task | null> {
    const updateData: Record<string, unknown> = {}
    if (input.title !== undefined) updateData.title = input.title
    if (input.description !== undefined) updateData.description = input.description
    if (input.status !== undefined) updateData.status = input.status
    if (input.priority !== undefined) updateData.priority = input.priority

    const [row] = await db
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, taskId))
      .returning()

    return row ? rowToTask(row) : null
  }

  async delete(taskId: string): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, taskId))
  }

  /**
   * Upsert tasks by content (title) for agent's todo_write tool.
   * - Same content exists → update status
   * - New content → create
   * - Status is 'cancelled' → delete if exists
   */
  async upsertByContent(
    projectId: string,
    todoItems: Array<{ content: string; status: string; priority?: string }>,
  ): Promise<Task[]> {
    const existing = await db.select().from(tasks).where(eq(tasks.projectId, projectId))
    const existingMap = new Map(existing.map((t) => [t.title, t]))

    for (const item of todoItems) {
      const existingTask = existingMap.get(item.content)

      if (item.status === 'cancelled') {
        if (existingTask) {
          await db.delete(tasks).where(eq(tasks.id, existingTask.id))
        }
        continue
      }

      if (existingTask) {
        await db
          .update(tasks)
          .set({
            status: item.status,
            ...(item.priority ? { priority: item.priority } : {}),
          })
          .where(eq(tasks.id, existingTask.id))
      } else {
        await db.insert(tasks).values({
          projectId,
          title: item.content,
          status: item.status === 'in_progress' ? 'in_progress' : item.status,
          priority: item.priority ?? 'medium',
        })
      }
    }

    return this.list(projectId)
  }

  async deleteAllByProject(projectId: string): Promise<void> {
    await db.delete(tasks).where(eq(tasks.projectId, projectId))
  }
}

export const taskService = new TaskService()
