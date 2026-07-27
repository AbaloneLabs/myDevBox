/**
 * Agent Tools - Registration and Factory
 *
 * Creates the full tool set for a project.
 * Based on pi's tool registration (opensource/pi/packages/coding-agent/src/core/tools/index.ts)
 * and forgecode's ToolCatalog.
 *
 * Plan 11 integration: write/edit/multi_edit/bash/remove tools
 * report to FileActivityTracker via afterToolCall hook (set up in Plan 7).
 */

import type { AgentTool } from '../types.js'
import type { ToolFactory, ToolOptions } from './types.js'

// File tools
import { createReadTool } from './file-tools.js'
import { createWriteTool } from './file-tools.js'
import { createEditTool } from './file-tools.js'
import { createMultiEditTool } from './file-tools.js'
import { createLsTool } from './file-tools.js'
import { createRemoveTool } from './file-tools.js'

// Command tool
import { createBashTool } from './bash.js'

// Search tools
import { createGrepTool } from './search-tools.js'
import { createFindTool } from './search-tools.js'

// Undo tool
import { createUndoTool } from './undo.js'

// Todo/Plan tools (in-memory version for factory; DB version available separately)
import { createTodoWriteTool } from './todo-plan.js'
import { createTodoReadTool } from './todo-plan.js'
import { createPlanCreateTool } from './todo-plan.js'

// Fetch tool
import { createFetchTool } from './fetch.js'

// Snapshot manager (for clearing on project switch)
export { snapshotManager } from './snapshot.js'

// DB-backed todo tools (used by WebSocket handler)
export { createDbTodoTools } from './todo-plan.js'

/**
 * Create the full set of agent tools for a project.
 *
 * @param projectPath - The project root directory (working directory for tools)
 * @param options - Tool configuration options
 * @returns Array of AgentTool instances
 */
export function createProjectTools(
  projectPath: string,
  options?: ToolOptions,
): AgentTool[] {
  return [
    createReadTool(projectPath, options),
    createWriteTool(projectPath, options),
    createEditTool(projectPath, options),
    createMultiEditTool(projectPath, options),
    createBashTool(projectPath, options),
    createGrepTool(projectPath, options),
    createFindTool(projectPath, options),
    createLsTool(projectPath, options),
    createRemoveTool(projectPath, options),
    createUndoTool(projectPath, options),
    createTodoWriteTool(projectPath, options),
    createTodoReadTool(projectPath, options),
    createPlanCreateTool(projectPath, options),
    createFetchTool(projectPath, options),
  ]
}

/**
 * Create a read-only tool set (safe mode).
 * Only allows reading and searching, no modifications.
 */
export function createReadOnlyTools(
  projectPath: string,
  options?: ToolOptions,
): AgentTool[] {
  return [
    createReadTool(projectPath, options),
    createGrepTool(projectPath, options),
    createFindTool(projectPath, options),
    createLsTool(projectPath, options),
  ]
}

/**
 * Get the list of tool names for a given tool set.
 */
export function getToolNames(tools: AgentTool[]): string[] {
  return tools.map(t => t.name)
}
