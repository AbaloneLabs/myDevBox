/**
 * Todo and Plan Tools
 *
 * todo_write / todo_read - manage task list (DB-backed)
 * plan_create - create plan documents (DB-backed)
 *
 * Based on forgecode's TodoWrite/TodoRead/PlanCreate.
 * These tools interact with the tasks and plans DB tables (Plan 8).
 */

import type { AgentTool, ToolResult } from '../types.js'
import type { ToolFactory } from './types.js'
import { taskService } from '../../services/task-service.js'
import { planService } from '../../services/plan-service.js'
import { connectionManager } from '../../ws/connection.js'

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError }
}

// ============ todo_write ============

export const createTodoWriteTool: ToolFactory = (cwd) => {
  const tool: AgentTool = {
    name: 'todo_write',
    description: 'Update the task list. Use this to track progress on multi-step tasks. Each todo item has a content description and a status (pending, in_progress, completed, cancelled). Setting status to cancelled removes the item. The content field is used as a unique key to match existing items.',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Task description (unique key)' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                description: 'Task status',
              },
            },
            required: ['content', 'status'],
          },
          description: 'Complete list of todo items',
        },
      },
      required: ['todos'],
    },
    async execute(_id, args) {
      const projectId = cwd  // cwd is set to project path, but we need the UUID
      // Note: In the actual agent loop, projectId is passed via context.
      // For now, we store todos in the DB by matching the project path.
      // The proper integration happens in Plan 7 (WebSocket) where projectId is known.
      const todoItems = args.todos as Array<{
        content: string
        status: string
      }>

      // Since we don't have direct access to projectId in the tool factory,
      // we store todos in memory. The actual DB sync happens via the API.
      // For now, return a formatted summary.
      const summary = todoItems
        .map((t, i) => {
          const icon =
            t.status === 'completed' ? '[x]' :
            t.status === 'in_progress' ? '[~]' :
            t.status === 'cancelled' ? '[-]' :
            '[ ]'
          return `${icon} ${t.content}`
        })
        .join('\n')

      return textResult(`Task list updated:\n${summary}`)
    },
  }

  return tool
}

// ============ todo_read ============

export const createTodoReadTool: ToolFactory = () => {
  const tool: AgentTool = {
    name: 'todo_read',
    description: 'Read the current task list. Returns all todo items with their statuses.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      // Placeholder - actual implementation reads from DB
      // The todo state is maintained in the agent context
      return textResult('(Task list is managed via todo_write. Use todo_write to set or update tasks.)')
    },
  }

  return tool
}

// ============ plan_create ============

export const createPlanCreateTool: ToolFactory = () => {
  const tool: AgentTool = {
    name: 'plan_create',
    description: 'Create a plan document. Plans are detailed implementation guides stored in the plans/ directory. Use this when breaking down complex tasks into steps.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_name: { type: 'string', description: 'Plan name (used for filename)' },
        version: { type: 'string', default: 'v1', description: 'Plan version' },
        content: { type: 'string', description: 'Plan content (markdown)' },
      },
      required: ['plan_name', 'content'],
    },
    async execute(_id, args) {
      const planName = args.plan_name as string
      const version = (args.version as string) ?? 'v1'
      const content = args.content as string

      // Placeholder - actual implementation writes to DB + filesystem
      // Full integration in Plan 8 (Tasks/Plans/Docs API)
      return textResult(
        `Plan "${planName}" (${version}) created successfully.\n` +
        `Content: ${content.length} characters.\n` +
        `(Note: Plan storage will be fully integrated in Plan 8.)`,
      )
    },
  }

  return tool
}

/**
 * Factory that creates DB-backed todo tools with a known projectId.
 * Used by the WebSocket handler (Plan 7) where projectId is available.
 * Broadcasts todo_updated and plan_created events via WebSocket.
 */
export function createDbTodoTools(projectId: string): AgentTool[] {
  const todoWrite: AgentTool = {
    name: 'todo_write',
    description: 'Update the task list. Each item has content (unique key) and status. Cancelled items are removed.',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
              priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    async execute(_id, args) {
      const todoItems = args.todos as Array<{
        content: string
        status: string
        priority?: string
      }>

      // Use taskService.upsertByContent for proper DB sync
      const updatedTasks = await taskService.upsertByContent(projectId, todoItems)

      // Broadcast todo_updated event via WebSocket
      connectionManager.broadcast(projectId, {
        type: 'todo_updated',
        todos: updatedTasks,
      })

      const summary = updatedTasks
        .map((t) => {
          const icon =
            t.status === 'completed' ? '[x]' :
            t.status === 'in_progress' ? '[~]' :
            '[ ]'
          return `${icon} ${t.title}`
        })
        .join('\n')

      return textResult(`Task list updated (${updatedTasks.length} items):\n${summary}`)
    },
  }

  const todoRead: AgentTool = {
    name: 'todo_read',
    description: 'Read the current task list with statuses.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const allTasks = await taskService.list(projectId)

      if (allTasks.length === 0) {
        return textResult('(no tasks)')
      }

      const summary = allTasks
        .map((t) => {
          const icon =
            t.status === 'completed' ? '[x]' :
            t.status === 'in_progress' ? '[~]' :
            '[ ]'
          return `${icon} ${t.title}`
        })
        .join('\n')

      return textResult(`Tasks (${allTasks.length}):\n${summary}`)
    },
  }

  const planCreate: AgentTool = {
    name: 'plan_create',
    description: 'Create a plan document. The plan is stored in the database and written to the project\'s plans/ directory.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_name: { type: 'string' },
        version: { type: 'string', default: 'v1' },
        content: { type: 'string' },
      },
      required: ['plan_name', 'content'],
    },
    async execute(_id, args) {
      const planName = args.plan_name as string
      const version = (args.version as string) ?? 'v1'
      const content = args.content as string

      // Use planService to create plan (DB + filesystem)
      const plan = await planService.create(projectId, {
        planName,
        version,
        content,
      })

      // Broadcast plan_created event via WebSocket
      connectionManager.broadcast(projectId, {
        type: 'agent_event',
        event: {
          type: 'tool_execution_end',
          toolName: 'plan_create',
          toolResult: { planId: plan.id },
          timestamp: Date.now(),
        },
      })

      return textResult(`Plan "${planName}" (${version}) created with ID: ${plan.id}`)
    },
  }

  return [todoWrite, todoRead, planCreate]
}
