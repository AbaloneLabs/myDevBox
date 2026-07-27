/**
 * WebSocket Connection Manager
 *
 * Manages WebSocket connections per project. Multiple clients (tabs, devices)
 * can connect to the same project and receive the same events.
 *
 * Based on the architecture described in Plan 7.
 */

import type { WebSocket } from 'ws'
import type { ServerMessage } from '@mydevbox/shared'

interface ConnectionInfo {
  ws: WebSocket
  projectId: string
  subscribedToFileChanges: boolean
}

class ConnectionManager {
  /** All active connections by projectId */
  private connections = new Map<string, Set<ConnectionInfo>>()

  /** Reverse lookup: ws → ConnectionInfo (for fast removal) */
  private wsToInfo = new Map<WebSocket, ConnectionInfo>()

  addConnection(projectId: string, ws: WebSocket): ConnectionInfo {
    const info: ConnectionInfo = {
      ws,
      projectId,
      subscribedToFileChanges: false,
    }

    if (!this.connections.has(projectId)) {
      this.connections.set(projectId, new Set())
    }
    this.connections.get(projectId)!.add(info)
    this.wsToInfo.set(ws, info)

    return info
  }

  removeConnection(ws: WebSocket): void {
    const info = this.wsToInfo.get(ws)
    if (!info) return

    const conns = this.connections.get(info.projectId)
    if (conns) {
      conns.delete(info)
      if (conns.size === 0) {
        this.connections.delete(info.projectId)
      }
    }
    this.wsToInfo.delete(ws)
  }

  /**
   * Broadcast a message to all connections for a project.
   */
  broadcast(projectId: string, message: ServerMessage): void {
    const conns = this.connections.get(projectId)
    if (!conns || conns.size === 0) return

    const data = JSON.stringify(message)
    for (const info of conns) {
      if (info.ws.readyState === wsReadyStateOpen) {
        info.ws.send(data)
      }
    }
  }

  /**
   * Send a message to a single connection.
   */
  send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === wsReadyStateOpen) {
      ws.send(JSON.stringify(message))
    }
  }

  /**
   * Broadcast file change events only to subscribed connections.
   */
  broadcastFileChange(projectId: string, message: ServerMessage): void {
    const conns = this.connections.get(projectId)
    if (!conns) return

    const data = JSON.stringify(message)
    for (const info of conns) {
      if (info.subscribedToFileChanges && info.ws.readyState === wsReadyStateOpen) {
        info.ws.send(data)
      }
    }
  }

  setFileChangeSubscription(ws: WebSocket, subscribed: boolean): void {
    const info = this.wsToInfo.get(ws)
    if (info) {
      info.subscribedToFileChanges = subscribed
    }
  }

  getConnectionCount(projectId: string): number {
    return this.connections.get(projectId)?.size ?? 0
  }

  getProjectIds(): string[] {
    return [...this.connections.keys()]
  }

  /**
   * Close all connections for a project (used on project deletion).
   */
  closeProjectConnections(projectId: string): void {
    const conns = this.connections.get(projectId)
    if (!conns) return

    for (const info of conns) {
      info.ws.close()
      this.wsToInfo.delete(info.ws)
    }
    this.connections.delete(projectId)
  }
}

// ws ReadyState.OPEN = 1
const wsReadyStateOpen = 1

export const connectionManager = new ConnectionManager()
