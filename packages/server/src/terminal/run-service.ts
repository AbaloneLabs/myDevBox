import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import type { RunResult, RunPreset } from '@mydevbox/shared'
import { db } from '../db/connection.js'
import { runPresets } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { resolveProjectPath } from '../services/path-service.js'

// 파일 확장자 → 실행 명령 매핑 (크로스 플랫폼: os.tmpdir() 사용)
function getRunners(): Record<string, { command: string; args?: string[] }> {
  return {
    '.js': { command: 'node' },
    '.mjs': { command: 'node' },
    '.cjs': { command: 'node' },
    '.ts': { command: 'npx', args: ['tsx'] },
    '.mts': { command: 'npx', args: ['tsx'] },
    '.py': { command: 'python3' },
    '.sh': { command: 'sh' },
    '.rb': { command: 'ruby' },
    '.go': { command: 'go', args: ['run'] },
    '.rs': {
      command: 'rustc',
      args: ['-o', path.join(os.tmpdir(), 'mydevbox-run')],
    },
  }
}

export interface RunInput {
  command: string
  args?: string[]
  cwd: string
  env?: Record<string, string>
  timeout?: number
  shell?: boolean
}

/**
 * 코드 실행 서비스
 * 파일 실행, 명령 실행, 실행 프리셋 관리
 */
class RunService {
  private runners = getRunners()

  /**
   * 파일 확장자에 맞는 실행기로 파일 실행
   */
  async runFile(
    projectId: string,
    projectPath: string,
    input: {
      file?: string
      command?: string
      args?: string[]
      cwd?: string
      env?: Record<string, string>
      timeout?: number
    },
  ): Promise<RunResult> {
    // 직접 명령이 제공된 경우 (셸 명령으로 실행)
    if (input.command) {
      const cwd = input.cwd
        ? resolveProjectPath(projectPath, input.cwd)
        : projectPath
      return this.execute({
        command: input.command,
        args: input.args,
        cwd,
        env: input.env,
        timeout: input.timeout,
        shell: true,
      })
    }

    // 파일 실행
    if (!input.file) {
      throw Object.assign(new Error('Either "file" or "command" must be provided'), {
        statusCode: 400,
      })
    }

    const filePath = resolveProjectPath(projectPath, input.file)
    const ext = path.extname(filePath)
    const runner = this.runners[ext]

    if (!runner) {
      throw Object.assign(new Error(`No runner for file type: ${ext}`), {
        statusCode: 400,
      })
    }

    const cwd = input.cwd
      ? resolveProjectPath(projectPath, input.cwd)
      : projectPath

    const args = [...(runner.args ?? []), filePath, ...(input.args ?? [])]
    const commandStr = `${runner.command} ${args.join(' ')}`

    const result = await this.execute({
      command: runner.command,
      args,
      cwd,
      env: input.env,
      timeout: input.timeout,
    })

    // Rust의 경우 컴파일 후 실행
    if (ext === '.rs') {
      const binaryPath = path.join(os.tmpdir(), 'mydevbox-run')
      const runResult = await this.execute({
        command: binaryPath,
        args: input.args,
        cwd,
        env: input.env,
        timeout: input.timeout,
      })
      // 컴파일 결과와 실행 결과 병합
      await fs.unlink(binaryPath).catch(() => {})
      return {
        ...runResult,
        stderr: result.stderr + runResult.stderr,
        command: commandStr,
      }
    }

    return { ...result, command: commandStr }
  }

  /**
   * 명령 실행 (비동기, 타임아웃 지원)
   */
  async execute(input: RunInput): Promise<RunResult> {
    const startTime = Date.now()
    const timeout = input.timeout ?? 60_000

    return new Promise((resolve) => {
      const proc = spawn(input.command, input.args ?? [], {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        shell: input.shell ?? false,
      })

      let stdout = ''
      let stderr = ''
      let truncated = false
      const MAX_OUTPUT = 100_000
      let killed = false

      const timer = setTimeout(() => {
        killed = true
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL')
        }, 2000)
      }, timeout)

      proc.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString()
        if (stdout.length + chunk.length > MAX_OUTPUT) {
          truncated = true
          const remaining = MAX_OUTPUT - stdout.length
          if (remaining > 0) stdout += chunk.slice(0, remaining)
        } else {
          stdout += chunk
        }
      })

      proc.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString()
        if (stderr.length + chunk.length > MAX_OUTPUT) {
          truncated = true
          const remaining = MAX_OUTPUT - stderr.length
          if (remaining > 0) stderr += chunk.slice(0, remaining)
        } else {
          stderr += chunk
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        resolve({
          exitCode: -1,
          stdout: '',
          stderr: err.message,
          duration: Date.now() - startTime,
          command: `${input.command} ${(input.args ?? []).join(' ')}`,
          truncated: false,
        })
      })

      proc.on('close', (exitCode) => {
        clearTimeout(timer)
        if (killed && stderr === '') {
          stderr = `\nProcess timed out after ${timeout}ms\n`
        }
        resolve({
          exitCode: exitCode ?? -1,
          stdout,
          stderr,
          duration: Date.now() - startTime,
          command: `${input.command} ${(input.args ?? []).join(' ')}`,
          truncated,
        })
      })
    })
  }

  // ============ 실행 프리셋 ============

  /**
   * 프로젝트의 실행 프리셋 목록 조회
   * DB에 저장된 프리셋 + package.json/Makefile에서 자동 감지
   */
  async getPresets(projectId: string, projectPath: string): Promise<RunPreset[]> {
    // DB에서 저장된 프리셋
    const dbPresets = await db
      .select()
      .from(runPresets)
      .where(eq(runPresets.projectId, projectId))

    // 자동 감지된 프리셋
    const autoPresets = await this.detectPresets(projectPath)

    // DB 프리셋을 RunPreset 타입으로 변환
    const saved: RunPreset[] = dbPresets.map((p) => ({
      id: p.id,
      projectId: p.projectId,
      name: p.name,
      command: p.command,
      cwd: p.cwd ?? undefined,
      env: p.env ? (p.env as Record<string, string>) : undefined,
      shortcut: p.shortcut ?? undefined,
      autoDetected: false,
    }))

    return [...autoPresets, ...saved]
  }

  /**
   * package.json, Makefile, Cargo.toml에서 프리셋 자동 감지
   */
  private async detectPresets(projectPath: string): Promise<RunPreset[]> {
    const presets: RunPreset[] = []

    // package.json scripts
    try {
      const pkgJsonPath = path.join(projectPath, 'package.json')
      const pkgContent = await fs.readFile(pkgJsonPath, 'utf-8')
      const pkg = JSON.parse(pkgContent)
      if (pkg.scripts) {
        for (const [name, command] of Object.entries(pkg.scripts)) {
          if (typeof command === 'string') {
            presets.push({
              id: `auto-npm-${name}`,
              projectId: '',
              name: name,
              command: `npm run ${name}`,
              autoDetected: true,
            })
          }
        }
      }
    } catch {
      // package.json 없음
    }

    // Makefile
    try {
      const makefilePath = path.join(projectPath, 'Makefile')
      const makeContent = await fs.readFile(makefilePath, 'utf-8')
      const targetRegex = /^([a-zA-Z_-]+):\s*$/gm
      let match
      while ((match = targetRegex.exec(makeContent)) !== null) {
        const target = match[1]
        if (!['phony', 'default'].includes(target)) {
          presets.push({
            id: `auto-make-${target}`,
            projectId: '',
            name: target,
            command: `make ${target}`,
            autoDetected: true,
          })
        }
      }
    } catch {
      // Makefile 없음
    }

    // Cargo.toml (Rust)
    try {
      const cargoPath = path.join(projectPath, 'Cargo.toml')
      await fs.access(cargoPath)
      presets.push(
        {
          id: 'auto-cargo-build',
          projectId: '',
          name: 'build',
          command: 'cargo build',
          autoDetected: true,
        },
        {
          id: 'auto-cargo-test',
          projectId: '',
          name: 'test',
          command: 'cargo test',
          autoDetected: true,
        },
        {
          id: 'auto-cargo-run',
          projectId: '',
          name: 'run',
          command: 'cargo run',
          autoDetected: true,
        },
      )
    } catch {
      // Cargo.toml 없음
    }

    return presets
  }

  /**
   * 실행 프리셋 생성 (DB 저장)
   */
  async createPreset(
    projectId: string,
    input: {
      name: string
      command: string
      cwd?: string
      env?: Record<string, string>
      shortcut?: string
    },
  ): Promise<RunPreset> {
    const id = crypto.randomUUID()
    await db.insert(runPresets).values({
      id,
      projectId,
      name: input.name,
      command: input.command,
      cwd: input.cwd,
      env: input.env,
      shortcut: input.shortcut,
    })

    return {
      id,
      projectId,
      name: input.name,
      command: input.command,
      cwd: input.cwd,
      env: input.env,
      shortcut: input.shortcut,
      autoDetected: false,
    }
  }

  /**
   * 실행 프리셋 삭제
   */
  async deletePreset(projectId: string, presetId: string): Promise<void> {
    await db
      .delete(runPresets)
      .where(and(eq(runPresets.id, presetId), eq(runPresets.projectId, projectId)))
  }
}

export const runService = new RunService()
