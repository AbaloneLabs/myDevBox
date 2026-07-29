/**
 * TsServerClient
 *
 * Spawns the TypeScript language server (`tsserver`) from the `typescript`
 * package and drives it over its native newline-delimited JSON protocol
 * (NOT standard LSP). The agent loop calls `syncFile` after editing a file and
 * `getDiagnostics` to retrieve real-time TS/JS errors for that file.
 *
 * This module is self-contained: it owns the tsserver child process and exposes
 * a small Promise-based API. It never throws across its public surface — if
 * tsserver fails to spawn or crashes, diagnostics calls resolve to `[]` so the
 * agent is never taken down by a tooling failure.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { logger } from '../logger.js'

const createRequireFn = createRequire(import.meta.url)

type ScriptKindName = 'TS' | 'TSX' | 'JS' | 'JSX'
type Severity = 'error' | 'warning' | 'info'
type DiagEventName = 'syntaxDiag' | 'semanticDiag' | 'suggestionDiag'

export interface Diagnostic {
  filePath: string
  /** 1-based line (tsserver is 0-based; converted on the way out). */
  line: number
  /** 1-based character / column offset. */
  character: number
  endLine?: number
  endCharacter?: number
  message: string
  severity: Severity
}

interface TsServerPos {
  line: number
  offset: number
}

interface TsServerRawDiag {
  start?: TsServerPos
  end?: TsServerPos
  text?: string
  category?: string
  code?: number
}

interface TsServerDiagBody {
  file: string
  diagnostics?: TsServerRawDiag[]
}

interface TsServerRequest {
  seq: number
  type: 'request'
  command: string
  arguments: Record<string, unknown>
}

interface TsServerMessage {
  seq: number
  type: 'response' | 'event'
  command?: string
  event?: string
  request_seq?: number
  success?: boolean
  message?: string
  body?: unknown
}

/** Maximum wait for the matching `semanticDiag` event before falling back. */
const DIAG_TIMEOUT_MS = 3000

export class TsServerClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private running = false
  private seq = 0
  private stdoutBuffer = ''

  /** file (normalized) -> (diag event name -> diagnostics) */
  private fileDiagnostics = new Map<string, Map<DiagEventName, Diagnostic[]>>()
  /** file (normalized) -> resolver for the pending `getDiagnostics` call */
  private semanticResolvers = new Map<string, () => void>()
  /** tsserver diag category -> our severity. Missing/unknown -> 'info'. */
  private static readonly SEVERITY_BY_CATEGORY: Record<string, Severity> = {
    error: 'error',
    warning: 'warning',
  }

  /** File extension -> tsserver scriptKindName. Missing/unknown -> 'TS'. */
  private static readonly SCRIPT_KIND_BY_EXT: Record<string, ScriptKindName> = {
    '.tsx': 'TSX',
    '.jsx': 'JSX',
    '.js': 'JS',
    '.mjs': 'JS',
    '.cjs': 'JS',
  }


  constructor() {
    let tsserverPath: string
    try {
      tsserverPath = createRequireFn.resolve('typescript/lib/tsserver.js')
    } catch (err) {
      logger.error({ err }, 'tsserver: could not resolve typescript/lib/tsserver.js')
      this.running = false
      return
    }

    try {
      this.proc = spawn('node', [tsserverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      logger.error({ err }, 'tsserver: spawn failed')
      this.running = false
      return
    }

    this.setupHandlers()
    this.running = true
  }

  /**
   * Open / refresh a file in tsserver's in-memory cache. Idempotent: re-sending
   * `open` with new content reloads the buffer.
   */
  async syncFile(absPath: string, content: string): Promise<void> {
    if (!this.running) return
    this.send('open', {
      file: absPath,
      fileContent: content,
      scriptKindName: TsServerClient.SCRIPT_KIND_BY_EXT[path.extname(absPath).toLowerCase()] ?? 'TS',
    })
  }

  /**
   * Request diagnostics for a file and resolve once the matching `semanticDiag`
   * event arrives (syntax diagnostics have already streamed in by then). Falls
   * back to a {@link DIAG_TIMEOUT_MS} timeout so a stalled tsserver can never
   * hang the caller. Returns diagnostics accumulated from every diag event seen
   * for the file, or `[]` if tsserver is unavailable.
   */
  async getDiagnostics(absPath: string): Promise<Diagnostic[]> {
    if (!this.running) return []
    const filePath = path.resolve(absPath)

    return new Promise<Diagnostic[]>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.semanticResolvers.delete(filePath)
        const byCategory = this.fileDiagnostics.get(filePath)
        const all: Diagnostic[] = byCategory ? [...byCategory.values()].flat() : []
        resolve(all)
      }

      const timer = setTimeout(finish, DIAG_TIMEOUT_MS)
      this.semanticResolvers.set(filePath, finish)

      // Drop any stale diagnostics so the result reflects only this request.
      this.fileDiagnostics.delete(filePath)

      this.send('geterr', { files: [absPath], delay: 0 })
    })
  }

  /** Tear down the tsserver child process. Safe to call multiple times. */
  close(): void {
    this.running = false
    for (const resolve of this.semanticResolvers.values()) resolve()
    this.semanticResolvers.clear()

    const proc = this.proc
    if (!proc) return
    try {
      proc.stdin.end()
    } catch {
      // stdin may already be closed
    }
    proc.kill('SIGTERM')
    this.proc = null
  }

  // ----- internals --------------------------------------------------------

  private setupHandlers(): void {
    const proc = this.proc
    if (!proc) return

    if (proc.stdout) {
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => {
        this.stdoutBuffer += chunk
        let newlineIndex = this.stdoutBuffer.indexOf('\n')
        while (newlineIndex >= 0) {
          const line = this.stdoutBuffer.slice(0, newlineIndex)
          this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
          newlineIndex = this.stdoutBuffer.indexOf('\n')
          if (line.trim()) this.handleMessage(line)
        }
      })
    }

    if (proc.stderr) {
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        const text = chunk.toString().trim()
        if (text) logger.warn({ stderr: text }, 'tsserver stderr')
      })
    }

    proc.on('error', (err) => {
      logger.error({ err }, 'tsserver process error')
      this.running = false
    })

    proc.on('exit', (code, signal) => {
      logger.warn({ code, signal }, 'tsserver exited')
      this.running = false
      // Release any waiters with whatever diagnostics accumulated so far.
      for (const resolve of this.semanticResolvers.values()) resolve()
      this.semanticResolvers.clear()
    })
  }

  private send(command: string, args: Record<string, unknown> = {}): number {
    const proc = this.proc
    if (!proc?.stdin || !this.running) return 0
    const seq = ++this.seq
    const message: TsServerRequest = { seq, type: 'request', command, arguments: args }
    try {
      proc.stdin.write(JSON.stringify(message) + '\n')
    } catch (err) {
      logger.error({ err, command }, 'tsserver send failed')
    }
    return seq
  }

  private handleMessage(line: string): void {
    let msg: TsServerMessage
    try {
      msg = JSON.parse(line) as TsServerMessage
    } catch {
      return // not a JSON line we care about
    }

    if (msg.type === 'event' && msg.event) {
      if (
        msg.event === 'syntaxDiag' ||
        msg.event === 'semanticDiag' ||
        msg.event === 'suggestionDiag'
      ) {
        this.handleDiagEvent(msg.event, msg.body as TsServerDiagBody | undefined)
      }
      return
    }

    if (msg.type === 'response' && msg.success === false) {
      logger.warn({ command: msg.command, message: msg.message }, 'tsserver request failed')
    }
  }

  private handleDiagEvent(eventName: DiagEventName, body?: TsServerDiagBody): void {
    if (!body?.file) return
    const filePath = path.resolve(body.file)
    const raw = body.diagnostics ?? []
    const diags = raw.map((d) => this.convertDiagnostic(filePath, d))

    let byCategory = this.fileDiagnostics.get(filePath)
    if (!byCategory) {
      byCategory = new Map()
      this.fileDiagnostics.set(filePath, byCategory)
    }
    byCategory.set(eventName, diags)

    // `semanticDiag` is the final meaningful error event in the geterr sequence;
    // syntax has already arrived. Resolve the waiter for this file (if any).
    if (eventName === 'semanticDiag') {
      const resolve = this.semanticResolvers.get(filePath)
      if (resolve) {
        this.semanticResolvers.delete(filePath)
        resolve()
      }
    }
  }

  private convertDiagnostic(filePath: string, d: TsServerRawDiag): Diagnostic {
    const start = d.start ?? { line: 0, offset: 0 }
    const end = d.end
    return {
      filePath,
      line: start.line + 1,
      character: start.offset + 1,
      endLine: end ? end.line + 1 : undefined,
      endCharacter: end ? end.offset + 1 : undefined,
      message: d.text ?? '',
      severity: TsServerClient.SEVERITY_BY_CATEGORY[d.category ?? ''] ?? 'info',
    }
  }

}
