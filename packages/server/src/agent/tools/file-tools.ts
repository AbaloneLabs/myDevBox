/**
 * File Tools
 *
 * read, write, edit, multi_edit, ls, remove
 *
 * Based on pi's read/write/edit tools and forgecode's FSRead/FSWrite/FSPatch.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AgentTool, TextContent, ToolResult } from '../types.js'
import type { ToolFactory, ToolOptions } from './types.js'
import { DEFAULT_TOOL_OPTIONS } from './types.js'
import { resolveProjectPath, toRelativePath } from '../../services/path-service.js'
import { detectLanguage } from '../../services/file-utils.js'
import { getLspClient } from '../../lsp/index.js'
import { snapshotManager } from './snapshot.js'

const MAX_READ_LINES = 2000

function isBinary(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192)
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true
  }
  return false
}

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError }
}
/** 02-B: 파일 콘텐츠 해시 (4-hex). read/edit 간 stale 검증용. omp hashline 패턴 참조. */
function fileHash(content: string): string {
  return crypto.createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex').slice(0, 4)
}

const LSP_EXTENSIONS: Record<string, true> = {
  '.ts': true, '.tsx': true, '.js': true, '.jsx': true, '.mts': true, '.cts': true,
}

/** 02-C: LSP writethrough — TS/JS 파일이면 tsserver로 진단 획득. 실패 시 빈 문자열(논블로킹). */
async function getLspDiagnosticsText(fullPath: string, content: string): Promise<string> {
  if (!LSP_EXTENSIONS[path.extname(fullPath)]) return ''
  try {
    const lsp = getLspClient()
    await lsp.syncFile(fullPath, content)
    const diags = await lsp.getDiagnostics(fullPath)
    if (diags.length === 0) return ''
    const lines = diags.map((d) => `  L${d.line}:${d.character} [${d.severity}] ${d.message}`)
    return `--- LSP Diagnostics (${diags.length}) ---\n${lines.join('\n')}`
  } catch {
    return ''
  }
}

// ============ read ============

export const createReadTool: ToolFactory = (cwd, options) => {
  const opts = { ...DEFAULT_TOOL_OPTIONS, ...options }

  const tool: AgentTool = {
    name: 'read',
    description: 'Read the contents of a file. Supports partial reads with start/end line numbers. Returns content with line numbers in the format "  1: first line".',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to read (relative to project root or absolute)' },
        start_line: { type: 'integer', minimum: 1, description: 'Starting line number (1-based)' },
        end_line: { type: 'integer', minimum: 1, description: 'Ending line number (1-based)' },
      },
      required: ['file_path'],
    },
    async execute(_id, args) {
      const filePath = args.file_path as string
      const startLine = args.start_line as number | undefined
      const endLine = args.end_line as number | undefined

      const fullPath = resolveProjectPath(cwd, filePath)

      if (!fs.existsSync(fullPath)) {
        return textResult(`File not found: ${filePath}`, true)
      }

      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        return textResult(`Path is a directory, not a file: ${filePath}`, true)
      }

      if (stat.size > opts.maxFileSize) {
        return textResult(`File too large: ${stat.size} bytes (max ${opts.maxFileSize})`, true)
      }

      const buffer = fs.readFileSync(fullPath)

      if (isBinary(buffer)) {
        return textResult(`Binary file: ${filePath} (${stat.size} bytes)`)
      }

      const content = buffer.toString('utf-8')
      const allLines = content.split('\n')

      const start = (startLine ?? 1) - 1
      const end = endLine ?? Math.min(allLines.length, start + MAX_READ_LINES)

      const selectedLines = allLines.slice(start, end)

      // Format with line numbers: "  1: content"
      const maxNumWidth = String(end).length
      const formatted = selectedLines
        .map((line, i) => `${String(start + i + 1).padStart(maxNumWidth)}: ${line}`)
        .join('\n')

      const hash = fileHash(content)
      const relPath = toRelativePath(cwd, fullPath)
      const header = `[${relPath}#${hash}]\n`
      let result = header + formatted
      if (allLines.length > end) {
        result += `\n... (${allLines.length - end} more lines, use start_line to continue reading)`
      }

      return textResult(result)
    },
  }

  return tool
}

// ============ write ============

export const createWriteTool: ToolFactory = (cwd, options) => {
  const tool: AgentTool = {
    name: 'write',
    description: 'Write content to a file. Creates the file if it does not exist. Overwrites if the file exists (use with caution). Parent directories are created automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to write' },
        content: { type: 'string', description: 'The content to write to the file' },
      },
      required: ['file_path', 'content'],
    },
    async execute(_id, args) {
      const filePath = args.file_path as string
      const content = args.content as string

      const fullPath = resolveProjectPath(cwd, filePath)

      // Save snapshot before write (for undo)
      snapshotManager.saveSnapshot(fullPath)

      // Create parent directories
      const parentDir = path.dirname(fullPath)
      fs.mkdirSync(parentDir, { recursive: true })

      fs.writeFileSync(fullPath, content, 'utf-8')

      const lineCount = content.split('\n').length
      const diagText = await getLspDiagnosticsText(fullPath, content)
      const baseMsg = `Successfully wrote ${lineCount} lines to ${filePath}`
      return textResult(diagText ? `${baseMsg}\n\n${diagText}` : baseMsg)
    },
  }

  return tool
}

// ============ edit ============

export const createEditTool: ToolFactory = (cwd) => {
  const tool: AgentTool = {
    name: 'edit',
    description: 'Perform a string replacement in a file. Use old_string to specify the exact text to replace and new_string for the replacement. By default replaces only the first occurrence; set replace_all to replace all occurrences. The edit will FAIL if old_string is not unique (unless replace_all=true).',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit' },
        old_string: { type: 'string', description: 'The exact text to replace' },
        new_string: { type: 'string', description: 'The text to replace it with' },
        replace_all: { type: 'boolean', default: false, description: 'Replace all occurrences' },
        tag: { type: 'string', description: 'Content hash tag from read (e.g. [path#a1b2]). Verifies file unchanged since last read.' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
    async execute(_id, args) {
      const filePath = args.file_path as string
      const oldString = args.old_string as string
      const newString = args.new_string as string
      const replaceAll = (args.replace_all as boolean) ?? false

      const fullPath = resolveProjectPath(cwd, filePath)

      if (!fs.existsSync(fullPath)) {
        return textResult(`File not found: ${filePath}`, true)
      }

      const content = fs.readFileSync(fullPath, 'utf-8')

      // 02-B: content-hash 검증 — tag가 있으면 파일이 변경됐는지 확인
      const editTag = args.tag as string | undefined
      if (editTag) {
        const expectedHash = editTag.match(/#([0-9a-f]{4})/)?.[1]
        if (expectedHash && expectedHash !== fileHash(content)) {
          return textResult(`File changed since last read (tag ${expectedHash} ≠ current). Re-read the file first.`, true)
        }
      }

      // Count occurrences
      let count = 0
      let idx = content.indexOf(oldString)
      while (idx !== -1) {
        count++
        idx = content.indexOf(oldString, idx + 1)
      }

      if (count === 0) {
        return textResult(`old_string not found in ${filePath}`, true)
      }

      if (!replaceAll && count > 1) {
        return textResult(
          `old_string found ${count} times in ${filePath}. Use replace_all=true or provide more context to make it unique.`,
          true,
        )
      }

      // Save snapshot
      snapshotManager.saveSnapshot(fullPath)

      // Perform replacement
      let newContent: string
      if (replaceAll) {
        newContent = content.split(oldString).join(newString)
      } else {
        newContent = content.replace(oldString, newString)
      }

      fs.writeFileSync(fullPath, newContent, 'utf-8')

      const replaced = replaceAll ? count : 1
      const diagText = await getLspDiagnosticsText(fullPath, newContent)
      const baseMsg = `Successfully edited ${filePath}: replaced ${replaced} occurrence(s)`
      return textResult(diagText ? `${baseMsg}\n\n${diagText}` : baseMsg)
    },
  }

  return tool
}

// ============ multi_edit ============

export const createMultiEditTool: ToolFactory = (cwd) => {
  const tool: AgentTool = {
    name: 'multi_edit',
    description: 'Apply multiple edits to a single file in sequence. Each edit is applied to the result of the previous edit. If any edit fails, the entire operation is rolled back.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string' },
              new_string: { type: 'string' },
              replace_all: { type: 'boolean', default: false },
            },
            required: ['old_string', 'new_string'],
          },
          description: 'List of edits to apply sequentially',
        },
        tag: { type: 'string', description: 'Content hash tag from read. Verifies file unchanged since last read.' },
      },
      required: ['file_path', 'edits'],
    },
    async execute(_id, args) {
      const filePath = args.file_path as string
      const edits = args.edits as Array<{
        old_string: string
        new_string: string
        replace_all?: boolean
      }>

      const fullPath = resolveProjectPath(cwd, filePath)

      if (!fs.existsSync(fullPath)) {
        return textResult(`File not found: ${filePath}`, true)
      }

      const originalContent = fs.readFileSync(fullPath, 'utf-8')

      // 02-B: content-hash 검증
      const multiTag = args.tag as string | undefined
      if (multiTag) {
        const expectedHash = multiTag.match(/#([0-9a-f]{4})/)?.[1]
        if (expectedHash && expectedHash !== fileHash(originalContent)) {
          return textResult(`File changed since last read (tag ${expectedHash} ≠ current). Re-read the file first.`, true)
        }
      }
      let content = originalContent

      // Save snapshot before any edits
      snapshotManager.saveSnapshot(fullPath)

      // Apply edits sequentially
      const results: string[] = []

      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i]
        const replaceAll = edit.replace_all ?? false

        let count = 0
        let idx = content.indexOf(edit.old_string)
        while (idx !== -1) {
          count++
          idx = content.indexOf(edit.old_string, idx + 1)
        }

        if (count === 0) {
          // Rollback
          fs.writeFileSync(fullPath, originalContent, 'utf-8')
          return textResult(
            `Edit ${i + 1} failed: old_string not found in ${filePath}. All changes rolled back.`,
            true,
          )
        }

        if (!replaceAll && count > 1) {
          fs.writeFileSync(fullPath, originalContent, 'utf-8')
          return textResult(
            `Edit ${i + 1} failed: old_string found ${count} times. Use replace_all=true or provide more context. All changes rolled back.`,
            true,
          )
        }

        if (replaceAll) {
          content = content.split(edit.old_string).join(edit.new_string)
        } else {
          content = content.replace(edit.old_string, edit.new_string)
        }

        results.push(`edit ${i + 1}: replaced ${replaceAll ? count : 1} occurrence(s)`)
      }

      fs.writeFileSync(fullPath, content, 'utf-8')

      const diagText = await getLspDiagnosticsText(fullPath, content)
      const baseMsg = `Successfully applied ${edits.length} edit(s) to ${filePath}:\n${results.join('\n')}`
      return textResult(diagText ? `${baseMsg}\n\n${diagText}` : baseMsg)
    },
  }

  return tool
}

// ============ ls ============

export const createLsTool: ToolFactory = (cwd) => {
  const tool: AgentTool = {
    name: 'ls',
    description: 'List the contents of a directory. Returns files and directories with their types.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '.', description: 'Directory path (relative to project root)' },
        recursive: { type: 'boolean', default: false, description: 'List recursively' },
        show_hidden: { type: 'boolean', default: false, description: 'Show hidden files' },
      },
    },
    async execute(_id, args) {
      const dirPath = (args.path as string) ?? '.'
      const recursive = (args.recursive as boolean) ?? false
      const showHidden = (args.show_hidden as boolean) ?? false

      const fullPath = resolveProjectPath(cwd, dirPath)

      if (!fs.existsSync(fullPath)) {
        return textResult(`Path not found: ${dirPath}`, true)
      }

      const stat = fs.statSync(fullPath)
      if (!stat.isDirectory()) {
        return textResult(`Path is not a directory: ${dirPath}`, true)
      }

      const entries = fs.readdirSync(fullPath, { withFileTypes: true })
        .filter(e => showHidden || !e.name.startsWith('.'))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1
          if (!a.isDirectory() && b.isDirectory()) return 1
          return a.name.localeCompare(b.name)
        })

      const lines: string[] = []

      for (const entry of entries) {
        const prefix = entry.isDirectory() ? '[DIR] ' : '      '
        lines.push(`${prefix}${entry.name}`)

        if (recursive && entry.isDirectory()) {
          const subPath = path.join(dirPath, entry.name)
          const subFullPath = path.join(fullPath, entry.name)
          const subEntries = fs.readdirSync(subFullPath, { withFileTypes: true })
            .filter(e => showHidden || !e.name.startsWith('.'))

          for (const sub of subEntries) {
            const subPrefix = sub.isDirectory() ? '  [DIR] ' : '        '
            lines.push(`${subPrefix}${sub.name}`)
          }
        }
      }

      if (lines.length === 0) {
        return textResult(`(empty directory: ${dirPath})`)
      }

      return textResult(lines.join('\n'))
    },
  }

  return tool
}

// ============ remove ============

export const createRemoveTool: ToolFactory = (cwd) => {
  const tool: AgentTool = {
    name: 'remove',
    description: 'Remove a file. The file content is snapshotted before deletion, so it can be restored with the undo tool. Directories are not removed for safety.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to remove' },
      },
      required: ['file_path'],
    },
    async execute(_id, args) {
      const filePath = args.file_path as string
      const fullPath = resolveProjectPath(cwd, filePath)

      if (!fs.existsSync(fullPath)) {
        return textResult(`File not found: ${filePath}`, true)
      }

      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        return textResult(
          `Path is a directory. Use bash tool with rm -rf to remove directories: ${filePath}`,
          true,
        )
      }

      // Save snapshot before removal
      snapshotManager.saveSnapshot(fullPath)

      fs.unlinkSync(fullPath)

      return textResult(`Successfully removed ${filePath}`)
    },
  }

  return tool
}
