/**
 * WebSocket Server Setup
 *
 * Initializes the WebSocket server and integrates it with Fastify's HTTP server.
 * Handles the upgrade handshake for /ws?projectId=<id> connections.
 *
 * Based on Plan 7 architecture.
 */

import { WebSocketServer, type WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'
import type { ClientMessage } from '@mydevbox/shared'
import { connectionManager } from './connection.js'
import { handleMessage, sendError } from './message-handler.js'
import { fileWatcher } from './file-watcher.js'
import { handleTerminalConnection } from '../terminal/ws-handler.js'
import { logger } from '../logger.js'

const WS_PATH = '/ws'
const WS_TERMINAL_PATH = '/ws/terminal'

export function setupWebSocket(app: FastifyInstance): void {
  const wss = new WebSocketServer({ noServer: true })

  // Handle HTTP upgrade to WebSocket
  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '', 'http://localhost')

    // Terminal WebSocket: /ws/terminal?projectId=<id>
    if (url.pathname.startsWith(WS_TERMINAL_PATH)) {
      const projectId = url.searchParams.get('projectId')
      if (!projectId) {
        socket.destroy()
        return
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        handleTerminalConnection(ws, projectId)
      })
      return
    }

    // Main WebSocket: /ws?projectId=<id>
    if (!url.pathname.startsWith(WS_PATH)) {
      // Let other upgrade requests pass through (or destroy)
      return
    }

    const projectId = url.searchParams.get('projectId')
    if (!projectId) {
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, projectId)
    })
  })

  wss.on('connection', (ws: WebSocket, projectId: string) => {
    // Register connection
    connectionManager.addConnection(projectId, ws)

    // Send connected confirmation
    connectionManager.send(ws, { type: 'connected', projectId })

    logger.info({ projectId }, 'WebSocket client connected')

    // Start file watcher for this project (if not already watching)
    // We need the project path - fetch it lazily
    startFileWatcherForProject(projectId)

    // Handle incoming messages
    ws.on('message', async (data: Buffer) => {
      let message: ClientMessage
      try {
        message = JSON.parse(data.toString()) as ClientMessage
      } catch {
        sendError(ws, 'Invalid JSON message')
        return
      }

      try {
        await handleMessage(ws, projectId, message)
      } catch (e) {
        logger.error({ err: e, projectId }, 'Message handler error')
        sendError(ws, e instanceof Error ? e.message : 'Internal error')
      }
    })

    // Handle disconnect
    ws.on('close', () => {
      connectionManager.removeConnection(ws)
      logger.info({ projectId }, 'WebSocket client disconnected')

      // If no more connections for this project, stop file watcher
      if (connectionManager.getConnectionCount(projectId) === 0) {
        fileWatcher.unwatch(projectId)
      }
    })

    ws.on('error', (err: Error) => {
      logger.error({ err, projectId }, 'WebSocket error')
      connectionManager.removeConnection(ws)
    })
  })

  // Cleanup on server close
  app.addHook('onClose', async () => {
    fileWatcher.closeAll()
    wss.close()
  })
}

/**
 * Fetch project path and start file watcher.
 */
async function startFileWatcherForProject(projectId: string): Promise<void> {
  try {
    const { db } = await import('../db/connection.js')
    const { projects } = await import('../db/schema.js')
    const { eq } = await import('drizzle-orm')

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
    if (project) {
      fileWatcher.watch(projectId, project.path)
    }
  } catch (e) {
    logger.error({ err: e, projectId }, 'Failed to start file watcher')
  }
}
