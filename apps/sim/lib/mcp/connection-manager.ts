/**
 * MCP Connection Manager
 *
 * Maintains persistent connections to MCP servers that support
 * `notifications/tools/list_changed`. When a notification arrives,
 * the manager invalidates the tools cache and emits a ToolsChangedEvent
 * so the frontend SSE endpoint can push updates to browsers.
 *
 * Servers that do not support `listChanged` fall back to the existing
 * stale-time cache approach — no persistent connection is kept.
 */

import { createLogger } from '@sim/logger'
import { isTest } from '@/lib/core/config/feature-flags'
import { McpClient } from '@/lib/mcp/client'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import type {
  ManagedConnectionState,
  McpServerConfig,
  McpToolsChangedCallback,
  ToolsChangedEvent,
} from '@/lib/mcp/types'

const logger = createLogger('McpConnectionManager')

const MAX_CONNECTIONS = 50
const MAX_RECONNECT_ATTEMPTS = 10
const BASE_RECONNECT_DELAY_MS = 1000
const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const IDLE_CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

type ToolsChangedListener = (event: ToolsChangedEvent) => void

class McpConnectionManager {
  private connections = new Map<string, McpClient>()
  private states = new Map<string, ManagedConnectionState>()
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private listeners = new Set<ToolsChangedListener>()
  private connectingServers = new Set<string>()
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false
  private unsubscribePubSub?: () => void

  constructor() {
    if (mcpPubSub) {
      this.unsubscribePubSub = mcpPubSub.onToolsChanged((event) => {
        this.notifyLocalListeners(event)
      })
    }
  }

  /**
   * Subscribe to tools-changed events from any managed connection.
   * Returns an unsubscribe function.
   */
  subscribe(listener: ToolsChangedListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Establish a persistent connection to an MCP server.
   * If the server supports `listChanged`, the connection is kept alive
   * and notifications are forwarded to subscribers.
   *
   * If the server does NOT support `listChanged`, the client is disconnected
   * immediately — there's nothing to listen for.
   */
  async connect(
    config: McpServerConfig,
    userId: string,
    workspaceId: string
  ): Promise<{ supportsListChanged: boolean }> {
    if (this.disposed) {
      logger.warn('Connection manager is disposed, ignoring connect request')
      return { supportsListChanged: false }
    }

    const serverId = config.id

    if (this.connections.has(serverId) || this.connectingServers.has(serverId)) {
      logger.info(`[${config.name}] Already has a managed connection or is connecting, skipping`)
      const state = this.states.get(serverId)
      return { supportsListChanged: state?.supportsListChanged ?? false }
    }

    if (this.connections.size >= MAX_CONNECTIONS) {
      logger.warn(`Max connections (${MAX_CONNECTIONS}) reached, cannot connect to ${config.name}`)
      return { supportsListChanged: false }
    }

    this.connectingServers.add(serverId)

    try {
      const onToolsChanged: McpToolsChangedCallback = (sid) => {
        this.handleToolsChanged(sid)
      }

      const client = new McpClient({
        config,
        securityPolicy: {
          requireConsent: false,
          auditLevel: 'basic',
          maxToolExecutionsPerHour: 1000,
        },
        onToolsChanged,
      })

      try {
        await client.connect()
      } catch (error) {
        logger.error(`[${config.name}] Failed to connect for persistent monitoring:`, error)
        return { supportsListChanged: false }
      }

      const supportsListChanged = client.hasListChangedCapability()

      if (!supportsListChanged) {
        logger.info(
          `[${config.name}] Server does not support listChanged — disconnecting (fallback to cache)`
        )
        await client.disconnect()
        return { supportsListChanged: false }
      }

      this.clearReconnectTimer(serverId)

      this.connections.set(serverId, client)
      this.states.set(serverId, {
        serverId,
        serverName: config.name,
        workspaceId,
        userId,
        connected: true,
        supportsListChanged: true,
        reconnectAttempts: 0,
        lastActivity: Date.now(),
      })

      client.onClose(() => {
        this.handleDisconnect(config, userId, workspaceId)
      })

      this.ensureIdleCheck()

      logger.info(`[${config.name}] Persistent connection established (listChanged supported)`)
      return { supportsListChanged: true }
    } finally {
      this.connectingServers.delete(serverId)
    }
  }

  /**
   * Disconnect a managed connection.
   */
  async disconnect(serverId: string): Promise<void> {
    this.clearReconnectTimer(serverId)

    const client = this.connections.get(serverId)
    if (client) {
      try {
        await client.disconnect()
      } catch (error) {
        logger.warn(`Error disconnecting managed client ${serverId}:`, error)
      }
      this.connections.delete(serverId)
    }

    this.states.delete(serverId)
    logger.info(`Managed connection removed: ${serverId}`)
  }

  /**
   * Check whether a managed connection exists for the given server.
   */
  hasConnection(serverId: string): boolean {
    return this.connections.has(serverId)
  }

  /**
   * Get connection state for a server.
   */
  getState(serverId: string): ManagedConnectionState | undefined {
    return this.states.get(serverId)
  }

  /**
   * Get all managed connection states (for diagnostics).
   */
  getAllStates(): ManagedConnectionState[] {
    return [...this.states.values()]
  }

  /**
   * Dispose all connections and timers.
   */
  dispose(): void {
    this.disposed = true

    this.unsubscribePubSub?.()

    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer)
    }
    this.reconnectTimers.clear()

    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer)
      this.idleCheckTimer = null
    }

    const disconnects = [...this.connections.entries()].map(async ([id, client]) => {
      try {
        await client.disconnect()
      } catch (error) {
        logger.warn(`Error disconnecting ${id} during dispose:`, error)
      }
    })

    Promise.allSettled(disconnects).then(() => {
      logger.info('Connection manager disposed')
    })

    this.connections.clear()
    this.states.clear()
    this.listeners.clear()
    this.connectingServers.clear()
  }

  /**
   * Notify only process-local listeners.
   * Called by the pub/sub subscription (receives events from all processes).
   */
  private notifyLocalListeners(event: ToolsChangedEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        logger.error('Error in tools-changed listener:', error)
      }
    }
  }

  /**
   * Handle a tools/list_changed notification from an external MCP server.
   * Publishes to pub/sub so all processes are notified.
   */
  private handleToolsChanged(serverId: string): void {
    const state = this.states.get(serverId)
    if (!state) return

    state.lastActivity = Date.now()

    const event: ToolsChangedEvent = {
      serverId,
      serverName: state.serverName,
      workspaceId: state.workspaceId,
      timestamp: Date.now(),
    }

    logger.info(`[${state.serverName}] Tools changed — publishing to pub/sub`)

    mcpPubSub?.publishToolsChanged(event)
  }

  private handleDisconnect(config: McpServerConfig, userId: string, workspaceId: string): void {
    const serverId = config.id
    const state = this.states.get(serverId)

    if (!state || this.disposed) return

    state.connected = false
    this.connections.delete(serverId)

    logger.warn(`[${config.name}] Persistent connection lost, scheduling reconnect`)

    this.scheduleReconnect(config, userId, workspaceId)
  }

  private scheduleReconnect(config: McpServerConfig, userId: string, workspaceId: string): void {
    const serverId = config.id
    const state = this.states.get(serverId)

    if (!state || this.disposed) return

    if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        `[${config.name}] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`
      )
      this.states.delete(serverId)
      return
    }

    const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** state.reconnectAttempts, 60_000)
    state.reconnectAttempts++

    logger.info(
      `[${config.name}] Reconnecting in ${delay}ms (attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    )

    this.clearReconnectTimer(serverId)

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(serverId)

      if (this.disposed) return

      const currentState = this.states.get(serverId)
      if (currentState?.connected) {
        logger.info(
          `[${config.name}] Connection already re-established externally, skipping reconnect`
        )
        return
      }

      const attempts = state.reconnectAttempts
      this.connections.delete(serverId)
      this.states.delete(serverId)

      try {
        const result = await this.connect(config, userId, workspaceId)
        if (result.supportsListChanged) {
          logger.info(`[${config.name}] Reconnected successfully`)
        } else {
          this.restoreReconnectState(config, userId, workspaceId, attempts)
          this.scheduleReconnect(config, userId, workspaceId)
        }
      } catch (error) {
        logger.error(`[${config.name}] Reconnect failed:`, error)
        this.restoreReconnectState(config, userId, workspaceId, attempts)
        this.scheduleReconnect(config, userId, workspaceId)
      }
    }, delay)

    this.reconnectTimers.set(serverId, timer)
  }

  private clearReconnectTimer(serverId: string): void {
    const timer = this.reconnectTimers.get(serverId)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(serverId)
    }
  }

  /**
   * Restore minimal state so `scheduleReconnect` can check attempts and continue the retry loop.
   */
  private restoreReconnectState(
    config: McpServerConfig,
    userId: string,
    workspaceId: string,
    reconnectAttempts: number
  ): void {
    if (!this.states.has(config.id)) {
      this.states.set(config.id, {
        serverId: config.id,
        serverName: config.name,
        workspaceId,
        userId,
        connected: false,
        supportsListChanged: false,
        reconnectAttempts,
        lastActivity: Date.now(),
      })
    }
  }

  private ensureIdleCheck(): void {
    if (this.idleCheckTimer) return

    this.idleCheckTimer = setInterval(() => {
      const now = Date.now()
      for (const [serverId, state] of this.states) {
        if (now - state.lastActivity > IDLE_TIMEOUT_MS) {
          logger.info(
            `[${state.serverName}] Idle timeout reached, disconnecting managed connection`
          )
          this.disconnect(serverId)
        }
      }

      if (this.states.size === 0 && this.idleCheckTimer) {
        clearInterval(this.idleCheckTimer)
        this.idleCheckTimer = null
      }
    }, IDLE_CHECK_INTERVAL_MS)
  }
}

export const mcpConnectionManager = isTest
  ? (null as unknown as McpConnectionManager)
  : new McpConnectionManager()
