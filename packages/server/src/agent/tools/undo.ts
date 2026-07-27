/**
 * Undo Tool
 *
 * Restores the most recent file snapshot.
 * Based on forgecode's FSUndo.
 */

import type { AgentTool, ToolResult } from '../types.js'
import type { ToolFactory } from './types.js'
import { resolveProjectPath } from '../../services/path-service.js'
import { snapshotManager } from './snapshot.js'

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError }
}

export const createUndoTool: ToolFactory = (cwd) => {
  const tool: AgentTool = {
    name: 'undo',
    description: 'Undo the most recent change to a file. Restores the file to its state before the last write/edit/remove operation. Only undoes the most recent change; multiple undo calls will step back through earlier snapshots.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to undo' },
      },
      required: ['file_path'],
    },
    async execute(_id, args) {
      const filePath = args.file_path as string
      const fullPath = resolveProjectPath(cwd, filePath)

      const restored = snapshotManager.restore(fullPath)

      if (!restored) {
        return textResult(
          `No snapshot available for ${filePath}. Nothing to undo.`,
          true,
        )
      }

      const remaining = snapshotManager.getSnapshotCount(fullPath)
      return textResult(
        `Successfully restored ${filePath} to previous state. (${remaining} snapshot(s) remaining)`,
      )
    },
  }

  return tool
}
