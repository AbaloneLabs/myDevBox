import { getDefaultShell, getShellEnv } from './shell-utils.js'

// node-pty lazy-load (네이티브 모듈이 빌드되지 않은 환경에서도 서버 시작 가능)
let ptyModule: typeof import('node-pty') | null = null
async function loadPty(): Promise<typeof import('node-pty')> {
  if (!ptyModule) {
    ptyModule = await import('node-pty')
  }
  return ptyModule
}

export interface PtyCreateOptions {
  cwd: string
  shell?: string
  cols?: number
  rows?: number
  env?: Record<string, string>
}

export interface PtySession {
  id: string
  process: import('node-pty').IPty
  cwd: string
  createdAt: number
}

/**
 * PTY 세션 관리 매니저
 * node-pty를 사용하여 가상 터미널 세션을 생성/관리
 */
class PtyManager {
  private sessions = new Map<string, PtySession>()
  private maxSessionsPerProject = 5
  private projectSessions = new Map<string, Set<string>>()

  async create(sessionId: string, projectId: string, options: PtyCreateOptions): Promise<PtySession> {
    // 프로젝트당 최대 세션 수 제한
    const projectSessionIds = this.projectSessions.get(projectId) ?? new Set()
    if (projectSessionIds.size >= this.maxSessionsPerProject) {
      throw new Error(
        `Maximum terminal sessions (${this.maxSessionsPerProject}) reached for this project`,
      )
    }

    const pty = await loadPty()
    const shell = options.shell ?? getDefaultShell()
    const cols = options.cols ?? 80
    const rows = options.rows ?? 24
    const env = getShellEnv(options.cwd, options.env)

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: options.cwd,
      env,
    })

    const session: PtySession = {
      id: sessionId,
      process: ptyProcess,
      cwd: options.cwd,
      createdAt: Date.now(),
    }

    this.sessions.set(sessionId, session)
    projectSessionIds.add(sessionId)
    this.projectSessions.set(projectId, projectSessionIds)

    return session
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.process.write(data)
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.process.resize(cols, rows)
    }
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      try {
        session.process.kill()
      } catch {
        // 프로세스가 이미 종료되었을 수 있음
      }
      this.sessions.delete(sessionId)
      // 프로젝트 세션 맵에서 제거
      for (const [projectId, sessionIds] of this.projectSessions) {
        if (sessionIds.delete(sessionId) && sessionIds.size === 0) {
          this.projectSessions.delete(projectId)
        }
      }
    }
  }

  killProjectSessions(projectId: string): void {
    const sessionIds = this.projectSessions.get(projectId)
    if (sessionIds) {
      for (const sessionId of sessionIds) {
        const session = this.sessions.get(sessionId)
        if (session) {
          try {
            session.process.kill()
          } catch {
            // 이미 종료됨
          }
          this.sessions.delete(sessionId)
        }
      }
      this.projectSessions.delete(projectId)
    }
  }

  getSession(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * 출력 콜백 등록
   */
  onOutput(sessionId: string, callback: (data: string) => void): (() => void) | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    const disposable = session.process.onData(callback)
    return () => disposable.dispose()
  }

  /**
   * 종료 콜백 등록
   */
  onExit(sessionId: string, callback: (exitCode: number, signal?: number) => void): (() => void) | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    const disposable = session.process.onExit(({ exitCode, signal }) => callback(exitCode, signal))
    return () => disposable.dispose()
  }

  getActiveSessionCount(): number {
    return this.sessions.size
  }
}

export const ptyManager = new PtyManager()
