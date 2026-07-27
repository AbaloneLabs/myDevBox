import type { WebSocket } from 'ws'
import type { TerminalClientMessage, TerminalServerMessage } from '@mydevbox/shared'
import { ptyManager } from './pty-manager.js'
import { projectService } from '../services/project-service.js'
import { logger } from '../logger.js'

/**
 * 터미널 WebSocket 연결 핸들러
 * 클라이언트의 터미널 입력을 PTY로 전달하고, PTY 출력을 클라이언트로 스트리밍
 */
export async function handleTerminalConnection(
  ws: WebSocket,
  projectId: string,
): Promise<void> {
  const sessionId = crypto.randomUUID()
  let disposed = false

  const send = (msg: TerminalServerMessage) => {
    if (disposed || ws.readyState !== ws.OPEN) return
    ws.send(JSON.stringify(msg))
  }

  ws.on('message', async (raw: Buffer) => {
    let message: TerminalClientMessage
    try {
      message = JSON.parse(raw.toString()) as TerminalClientMessage
    } catch {
      send({ type: 'error', message: 'Invalid JSON message' })
      return
    }

    switch (message.type) {
      case 'create': {
        try {
          // 프로젝트 경로 조회
          const project = await projectService.getById(projectId)
          if (!project) {
            send({ type: 'error', message: 'Project not found' })
            return
          }

          const cwd = message.cwd ?? project.path
          const session = await ptyManager.create(sessionId, projectId, {
            cwd,
            shell: message.shell,
            cols: message.cols,
            rows: message.rows,
          })

          send({ type: 'created', sessionId: session.id })

          // 출력 스트리밍
          const disposeOutput = ptyManager.onOutput(sessionId, (data) => {
            send({ type: 'output', data })
          })

          // 종료 이벤트
          const disposeExit = ptyManager.onExit(sessionId, (exitCode) => {
            send({ type: 'exited', exitCode })
            disposeOutput?.()
            disposeExit?.()
          })

          logger.info({ sessionId, projectId, cwd }, 'Terminal session created')
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to create terminal'
          send({ type: 'error', message: msg })
        }
        break
      }

      case 'input': {
        ptyManager.write(sessionId, message.data)
        break
      }

      case 'resize': {
        ptyManager.resize(sessionId, message.cols, message.rows)
        break
      }

      case 'kill': {
        ptyManager.kill(sessionId)
        break
      }
    }
  })

  ws.on('close', () => {
    disposed = true
    ptyManager.kill(sessionId)
    logger.info({ sessionId, projectId }, 'Terminal session closed')
  })

  ws.on('error', (err) => {
    disposed = true
    ptyManager.kill(sessionId)
    logger.error({ err, sessionId, projectId }, 'Terminal WebSocket error')
  })
}
