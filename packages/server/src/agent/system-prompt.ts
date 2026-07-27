/**
 * System Prompt Builder
 *
 * Based on pi's system-prompt.ts (opensource/pi/packages/coding-agent/src/core/system-prompt.ts)
 * and forgecode's system_prompt.rs
 */

import type { ToolDefinition } from './types.js'

export interface SystemPromptOptions {
  projectName: string
  projectPath: string
  tools: ToolDefinition[]
  gitBranch?: string
  platform?: string          // process.platform
  shell?: string             // user's shell
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const {
    projectName,
    projectPath,
    tools,
    gitBranch,
    platform = process.platform,
    shell = process.env.SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'),
  } = options

  const toolsList = tools
    .map(t => `- ${t.name}: ${t.description.split('\n')[0]}`)
    .join('\n')

  const currentDate = new Date().toISOString().split('T')[0]

  return `You are an expert coding assistant operating inside MyDevBox, a web-based development environment.

You help users by reading files, executing commands, editing code, writing new files, and managing git operations.

## Environment
- Project: ${projectName}
- Working directory: ${projectPath}
${gitBranch ? `- Git branch: ${gitBranch}` : ''}
- Platform: ${platform}
- Shell: ${shell}

## Available Tools
${toolsList}

## Guidelines
- Be concise in your responses
- Show file paths clearly when working with files
- Always read a file before editing it
- Explain what you're about to do before using tools
- Use the todo tool to track multi-step tasks
- When making file changes, show a summary of what changed
- Use cross-platform compatible paths (path.join, path.sep)
- Use os.homedir() instead of ~ for home directory
- Use os.tmpdir() instead of /tmp for temporary files

Current date: ${currentDate}`
}
