/**
 * Bash Tool
 *
 * Executes shell commands with timeout and output truncation.
 * Based on pi's bash tool (opensource/pi/packages/coding-agent/src/core/tools/bash.ts)
 * and forgecode's Shell tool.
 *
 * Cross-platform: uses process.env.SHELL or falls back to platform default.
 */

import { exec } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { AgentTool, ToolResult } from '../types.js'
import type { ToolFactory } from './types.js'
import { DEFAULT_TOOL_OPTIONS } from './types.js'
import { truncateOutput } from './truncate.js'

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError }
}

/**
 * Get the default shell for the current platform.
 * Cross-platform: Windows → powershell, Unix → SHELL env or sh.
 * Uses /bin/sh (POSIX) as fallback since it's guaranteed on all Unix systems.
 */
function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.SHELL ?? 'powershell.exe'
  }
  return process.env.SHELL ?? '/bin/sh'
}

// Commands that are blocked for safety
const BLOCKED_COMMANDS = ['vim', 'vi', 'nano', 'emacs', 'top', 'htop', 'less', 'more']

export const createBashTool: ToolFactory = (cwd, options) => {
  const opts = { ...DEFAULT_TOOL_OPTIONS, ...options }

  const tool: AgentTool = {
    name: 'bash',
    description: 'Execute a shell command and return stdout/stderr. Commands run in the project root by default. Output is truncated if too large. Interactive commands (vim, top, etc.) are blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (defaults to project root)' },
        timeout: { type: 'integer', description: `Timeout in ms (default: ${opts.commandTimeout})` },
      },
      required: ['command'],
    },
    async execute(_id, args, signal) {
      const command = args.command as string
      const workingDir = args.cwd ? resolveWorkingDir(cwd, args.cwd as string) : cwd
      const timeout = (args.timeout as number) ?? opts.commandTimeout

      // Check for blocked commands
      const cmdLower = command.toLowerCase()
      for (const blocked of BLOCKED_COMMANDS) {
        if (cmdLower.includes(blocked)) {
          return textResult(
            `Interactive command '${blocked}' is not allowed. Use non-interactive alternatives.`,
            true,
          )
        }
      }

      const shell = getDefaultShell()

      return new Promise<ToolResult>((resolve) => {
        let resolved = false

        const done = (result: ToolResult) => {
          if (!resolved) {
            resolved = true
            resolve(result)
          }
        }

        const child = exec(command, {
          cwd: workingDir,
          env: { ...process.env },
          shell,
          timeout,
          maxBuffer: opts.maxOutputBytes,
        })

        let stdout = ''
        let stderr = ''

        child.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString('utf-8')
        })

        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString('utf-8')
        })

        // Abort signal
        if (signal) {
          signal.addEventListener('abort', () => {
            child.kill('SIGTERM')
            done(textResult('Command aborted', true))
          })
        }

        child.on('close', (code, signalName) => {
          // Truncate output
          const stdoutResult = truncateOutput(stdout, opts.maxOutputLines, opts.maxOutputBytes)
          const stderrResult = truncateOutput(stderr, opts.maxOutputLines, opts.maxOutputBytes)

          let output = ''
          if (stdoutResult.content) {
            output += stdoutResult.content
          }
          if (stderrResult.content) {
            output += (output ? '\n\n--- stderr ---\n' : '') + stderrResult.content
          }

          if (stdoutResult.truncated || stderrResult.truncated) {
            output += '\n(output was truncated)'
          }

          if (signalName === 'SIGTERM') {
            output += `\n(command timed out after ${timeout}ms)`
          }

          if (!output) {
            output = `(no output, exit code: ${code})`
          } else {
            output += `\n(exit code: ${code})`
          }

          done(textResult(output, code !== 0))
        })

        child.on('error', (err) => {
          done(textResult(`Failed to execute command: ${err.message}`, true))
        })
      })
    },
  }

  return tool
}

/**
 * Resolve working directory relative to cwd.
 */
function resolveWorkingDir(cwd: string, dir: string): string {
  if (dir === '~') return os.homedir()
  if (dir.startsWith('~/') || dir.startsWith('~\\')) {
    return path.join(os.homedir(), dir.slice(2))
  }
  return path.resolve(cwd, dir)
}
