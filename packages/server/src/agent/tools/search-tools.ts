/**
 * Search Tools
 *
 * grep - file content search using ripgrep (@vscode/ripgrep)
 * find - file name search using fast-glob
 *
 * Based on forgecode's FSSearch and pi's grep tool.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rgPath } from '@vscode/ripgrep'
import fg from 'fast-glob'
import path from 'node:path'
import type { AgentTool, ToolResult } from '../types.js'
import type { ToolFactory } from './types.js'
import { resolveProjectPath, toRelativePath } from '../../services/path-service.js'
import { truncateOutput } from './truncate.js'

const execFileAsync = promisify(execFile)

const SEARCH_TIMEOUT_MS = 10_000
const SEARCH_MAX_RESULTS = 1000

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError }
}

// ============ grep ============

export const createGrepTool: ToolFactory = (cwd) => {
  const tool: AgentTool = {
    name: 'grep',
    description: 'Search file contents using ripgrep. Supports regex patterns, file globs, context lines, case-insensitive search, and multiple output modes. Returns matching lines with file paths and line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression pattern to search for' },
        path: { type: 'string', description: 'Directory or file to search in (defaults to project root)' },
        glob: { type: 'string', description: 'File glob pattern (e.g. "*.ts")' },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
          default: 'files_with_matches',
          description: 'Output mode',
        },
        '-A': { type: 'integer', description: 'Lines to show after each match' },
        '-B': { type: 'integer', description: 'Lines to show before each match' },
        '-C': { type: 'integer', description: 'Lines of context around each match' },
        '-i': { type: 'boolean', description: 'Case insensitive' },
        '-n': { type: 'boolean', default: true, description: 'Show line numbers' },
        type: { type: 'string', description: 'File type (e.g. "ts", "py")' },
        head_limit: { type: 'integer', description: 'Limit number of results' },
      },
      required: ['pattern'],
    },
    async execute(_id, args) {
      const pattern = args.pattern as string
      const searchPath = args.path ? resolveProjectPath(cwd, args.path as string) : cwd
      const glob = args.glob as string | undefined
      const outputMode = (args.output_mode as string) ?? 'files_with_matches'
      const afterContext = args['-A'] as number | undefined
      const beforeContext = args['-B'] as number | undefined
      const context = args['-C'] as number | undefined
      const caseInsensitive = args['-i'] as boolean | undefined
      const fileType = args.type as string | undefined
      const headLimit = (args.head_limit as number | undefined) ?? SEARCH_MAX_RESULTS

      const rgArgs: string[] = ['--json', '--max-count', String(headLimit)]

      if (glob) rgArgs.push('--glob', glob)
      if (afterContext) rgArgs.push('-A', String(afterContext))
      if (beforeContext) rgArgs.push('-B', String(beforeContext))
      if (context) rgArgs.push('-C', String(context))
      if (caseInsensitive) rgArgs.push('-i')
      if (fileType) rgArgs.push('--type', fileType)

      // Ignore common patterns
      for (const ignore of ['node_modules', '.git', 'dist', 'build']) {
        rgArgs.push('--glob', `!${ignore}`)
      }

      rgArgs.push(pattern, searchPath)

      let stdout: string
      try {
        const result = await execFileAsync(rgPath, rgArgs, {
          timeout: SEARCH_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          cwd,
        })
        stdout = result.stdout
      } catch (e) {
        const err = e as { code?: number; stdout?: string; stderr?: string }
        // ripgrep returns exit code 1 when no matches
        if (err.code === 1) {
          stdout = err.stdout ?? ''
        } else {
          return textResult(`Search error: ${err.stderr ?? 'ripgrep failed'}`, true)
        }
      }

      const output = formatRipgrepOutput(stdout, cwd, outputMode)
      const truncated = truncateOutput(output, 500, 100_000)

      if (!truncated.content) {
        return textResult('No matches found')
      }

      return textResult(
        truncated.content + (truncated.truncated ? '\n(results truncated)' : ''),
      )
    },
  }

  return tool
}

/**
 * Format ripgrep --json output into readable text.
 */
function formatRipgrepOutput(
  stdout: string,
  projectRoot: string,
  outputMode: string,
): string {
  const lines = stdout.trim().split('\n').filter(Boolean)
  const results: string[] = []
  const matchedFiles = new Set<string>()
  let matchCount = 0

  for (const line of lines) {
    try {
      const msg = JSON.parse(line)

      if (msg.type === 'match') {
        const filePath = toRelativePath(projectRoot, msg.data.path.text)
        const lineNumber = msg.data.line_number
        const text = (msg.data.lines?.text ?? '').replace(/\n$/, '')

        if (outputMode === 'files_with_matches') {
          if (!matchedFiles.has(filePath)) {
            matchedFiles.add(filePath)
            results.push(filePath)
          }
        } else if (outputMode === 'count') {
          matchCount++
        } else {
          // content mode
          results.push(`${filePath}:${lineNumber}: ${text}`)
        }
      }
    } catch {
      continue
    }
  }

  if (outputMode === 'count') {
    return `Found ${matchCount} match(es) in ${matchedFiles.size} file(s)`
  }

  if (results.length === 0) {
    return ''
  }

  return results.join('\n')
}

// ============ find ============

export const createFindTool: ToolFactory = (cwd) => {
  const tool: AgentTool = {
    name: 'find',
    description: 'Find files by name pattern (glob). Uses fast-glob for cross-platform file searching. Returns matching file paths relative to the project root.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'File name glob pattern (e.g. "**/*.ts", "*.json")' },
        path: { type: 'string', description: 'Search directory (defaults to project root)' },
        type: { type: 'string', enum: ['file', 'directory'], description: 'Filter by type' },
      },
      required: ['pattern'],
    },
    async execute(_id, args) {
      const pattern = args.pattern as string
      const searchPath = args.path ? resolveProjectPath(cwd, args.path as string) : cwd
      const type = args.type as string | undefined

      const globPattern = pattern.startsWith('**') ? pattern : `**/${pattern}`

      const options = {
        cwd: searchPath,
        onlyFiles: type === 'file' ? true : undefined,
        onlyDirectories: type === 'directory' ? true : undefined,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
        dot: false,
      }

      try {
        const matches = await fg(globPattern, options)

        if (matches.length === 0) {
          return textResult('No files found matching the pattern')
        }

        // Sort and limit
        const sorted = matches.sort()
        const limited = sorted.slice(0, SEARCH_MAX_RESULTS)

        let output = limited.join('\n')
        if (sorted.length > SEARCH_MAX_RESULTS) {
          output += `\n... (${sorted.length - SEARCH_MAX_RESULTS} more results truncated)`
        }

        return textResult(output)
      } catch (e) {
        return textResult(`Find error: ${(e as Error).message}`, true)
      }
    },
  }

  return tool
}
