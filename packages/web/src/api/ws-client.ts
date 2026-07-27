/**
 * WebSocket Client
 *
 * Manages WebSocket connection to the backend for real-time agent events,
 * file changes, and todo updates.
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Event-based message dispatch
 * - Connection state tracking
 */

import type { ClientMessage, ServerMessage } from '@mydevbox/shared'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

type MessageHandler = (message: ServerMessage) => void
type StateHandler = (state: ConnectionState) => void

class WSClient {
  private ws: WebSocket | null = null
  private projectId: string | null = null
  private state: ConnectionState = 'disconnected'

  private listeners = new Map<string, Set<MessageHandler>>()
  private stateListeners = new Set<StateHandler>()

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private shouldReconnect = false

  /**
   * Connect to the WebSocket server for a project.
   */
  connect(projectId: string): void {
    this.projectId = projectId
    this.shouldReconnect = true
    this.reconnectDelay = 1000
    this.doConnect()
  }

  /**
   * Disconnect and stop reconnecting.
   */
  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setState('disconnected')
  }

  /**
   * Send a message to the server.
   */
  send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  /**
   * Register a handler for a specific message type.
   */
  on(type: string, handler: MessageHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.listeners.get(type)?.delete(handler)
    }
  }

  /**
   * Register a handler for connection state changes.
   */
  onStateChange(handler: StateHandler): () => void {
    this.stateListeners.add(handler)
    handler(this.state)
    return () => {
      this.stateListeners.delete(handler)
    }
  }

  getConnectionState(): ConnectionState {
    return this.state
  }

  // ============ Internal ============

  private doConnect(): void {
    if (!this.projectId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws?projectId=${this.projectId}`

    this.setState(this.state === 'disconnected' ? 'connecting' : 'reconnecting')

    try {
      this.ws = new WebSocket(wsUrl)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000
      this.setState('connected')
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const message: ServerMessage = JSON.parse(event.data as string)
        this.emit(message.type, message)
        // Also emit to wildcard listeners
        this.emit('*', message)
      } catch {
        // Invalid JSON, ignore
      }
    }

    this.ws.onerror = () => {
      // Error is usually followed by close, which triggers reconnect
    }

    this.ws.onclose = () => {
      this.ws = null
      this.setState('disconnected')
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return

    this.setState('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
      this.doConnect()
    }, this.reconnectDelay)
  }

  private emit(type: string, message: ServerMessage): void {
    const handlers = this.listeners.get(type)
    if (handlers) {
      for (const handler of handlers) {
        handler(message)
      }
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    for (const handler of this.stateListeners) {
      handler(state)
    }
  }
}

export const wsClient = new WSClient()
