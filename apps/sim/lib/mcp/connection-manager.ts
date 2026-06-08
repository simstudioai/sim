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
import { backoffWithJitter } from '@sim/utils/retry'
import { isTest } from '@/lib/core/config/feature-flags'
import { McpClient } from '@/lib/mcp/client'
import { getOrCreateOauthRow, loadPreregisteredClient, SimMcpOauthProvider } from '@/lib/mcp/oauth'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import type {
  ManagedConnectionState,
  McpClientOptions,
  McpServerConfig,
  McpToolsChangedCallback,
  ToolsChangedEvent,
} from '@/lib/mcp/types'

const logger = createLogger('McpConnectionManager')

const MAX_CONNECTIONS = 50
const MAX_RECONNECT_ATTEMPTS = 10
const BASE_RECONNECT_DELAY_MS = 1000
const CONNECT_TIMEOUT_MS = 15_000
const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const IDLE_CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

type ToolsChangedListener = (event: ToolsChangedEvent) => void

async function withConnectTimeout(client: McpClient, serverName: string): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const connectPromise = client.connect({ isCancelled: () => timedOut })
  try {
    await Promise.race([
      connectPromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true
          reject(new Error(`Timed out connecting to MCP server ${serverName}`))
        }, CONNECT_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    if (timedOut) {
      void connectPromise.catch(() => {})
    }
    await client.disconnect().catch(() => {})
    throw error
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/**
 * Cache key for managed connections.
 * MCP servers are workspace-owned, so OAuth/header/no-auth connections are
 * keyed by server and share the same workspace-scoped server credentials.
 */
function connectionKey(config: McpServerConfig): string {
  return config.id
}

export class McpConnectionManager {
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
    workspaceId: string,
    resolvedIP?: string | null
  ): Promise<{ supportsListChanged: boolean }> {
    if (this.disposed) {
      logger.warn('Connection manager is disposed, ignoring connect request')
      return { supportsListChanged: false }
    }

    const key = connectionKey(config)

    if (this.connections.has(key) || this.connectingServers.has(key)) {
      logger.info(`[${config.name}] Already has a managed connection or is connecting, skipping`)
      const state = this.states.get(key)
      return { supportsListChanged: state?.supportsListChanged ?? false }
    }

    if (this.connections.size >= MAX_CONNECTIONS) {
      logger.warn(`Max connections (${MAX_CONNECTIONS}) reached, cannot connect to ${config.name}`)
      return { supportsListChanged: false }
    }

    this.connectingServers.add(key)

    try {
      const onToolsChanged: McpToolsChangedCallback = () => {
        this.handleToolsChanged(key)
      }

      let authProvider: McpClientOptions['authProvider']
      if (config.authType === 'oauth') {
        const row = await getOrCreateOauthRow({
          mcpServerId: config.id,
          userId,
          workspaceId,
        })
        if (!row.tokens) {
          logger.info(
            `[${config.name}] OAuth server has no workspace tokens — skipping persistent connection until authorized`
          )
          return { supportsListChanged: false }
        }
        const preregistered = await loadPreregisteredClient(config.id)
        authProvider = new SimMcpOauthProvider({ row, preregistered })
      }

      const client = new McpClient({
        config,
        securityPolicy: {
          requireConsent: false,
          auditLevel: 'basic',
          maxToolExecutionsPerHour: 1000,
        },
        onToolsChanged,
        resolvedIP: resolvedIP ?? undefined,
        authProvider,
      })

      try {
        await withConnectTimeout(client, config.name)
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

      this.clearReconnectTimer(key)

      this.connections.set(key, client)
      this.states.set(key, {
        serverId: config.id,
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
      this.connectingServers.delete(key)
    }
  }

  /**
   * Disconnect a managed connection by internal cache key.
   */
  private async disconnectByKey(key: string): Promise<void> {
    this.clearReconnectTimer(key)

    const client = this.connections.get(key)
    if (client) {
      this.connections.delete(key)
      this.states.delete(key)
      try {
        await client.disconnect()
      } catch (error) {
        logger.warn(`Error disconnecting managed client ${key}:`, error)
      }
    } else {
      this.states.delete(key)
    }

    logger.info(`Managed connection removed: ${key}`)
  }

  /**
   * Disconnect the managed connection for the given server.
   */
  async disconnectServer(serverId: string): Promise<void> {
    const keys: string[] = []
    for (const [key, state] of this.states) {
      if (state.serverId === serverId) keys.push(key)
    }
    await Promise.all(keys.map((key) => this.disconnectByKey(key)))
  }

  /**
   * Check whether a managed connection exists for the given server.
   */
  hasConnection(serverId: string): boolean {
    for (const state of this.states.values()) {
      if (state.serverId === serverId) return true
    }
    return false
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
  private handleToolsChanged(key: string): void {
    const state = this.states.get(key)
    if (!state) return

    state.lastActivity = Date.now()

    const event: ToolsChangedEvent = {
      serverId: state.serverId,
      serverName: state.serverName,
      workspaceId: state.workspaceId,
      timestamp: Date.now(),
    }

    logger.info(`[${state.serverName}] Tools changed — publishing to pub/sub`)

    mcpPubSub?.publishToolsChanged(event)
  }

  private handleDisconnect(config: McpServerConfig, userId: string, workspaceId: string): void {
    const key = connectionKey(config)
    const state = this.states.get(key)

    if (!state || this.disposed) return

    state.connected = false
    this.connections.delete(key)

    logger.warn(`[${config.name}] Persistent connection lost, scheduling reconnect`)

    this.scheduleReconnect(config, userId, workspaceId)
  }

  private scheduleReconnect(config: McpServerConfig, userId: string, workspaceId: string): void {
    const key = connectionKey(config)
    const state = this.states.get(key)

    if (!state || this.disposed) return

    if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        `[${config.name}] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`
      )
      this.states.delete(key)
      return
    }

    state.reconnectAttempts++
    const delay = backoffWithJitter(state.reconnectAttempts, null, {
      baseMs: BASE_RECONNECT_DELAY_MS,
      maxMs: 60_000,
    })

    logger.info(
      `[${config.name}] Reconnecting in ${delay}ms (attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    )

    this.clearReconnectTimer(key)

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(key)

      if (this.disposed) return

      const currentState = this.states.get(key)
      if (currentState?.connected) {
        logger.info(
          `[${config.name}] Connection already re-established externally, skipping reconnect`
        )
        return
      }

      const attempts = state.reconnectAttempts
      this.connections.delete(key)
      this.states.delete(key)

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

    this.reconnectTimers.set(key, timer)
  }

  private clearReconnectTimer(key: string): void {
    const timer = this.reconnectTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(key)
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
    const key = connectionKey(config)
    if (!this.states.has(key)) {
      this.states.set(key, {
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
      for (const [key, state] of this.states) {
        if (now - state.lastActivity > IDLE_TIMEOUT_MS) {
          logger.info(
            `[${state.serverName}] Idle timeout reached, disconnecting managed connection`
          )
          this.disconnectByKey(key)
        }
      }

      if (this.states.size === 0 && this.idleCheckTimer) {
        clearInterval(this.idleCheckTimer)
        this.idleCheckTimer = null
      }
    }, IDLE_CHECK_INTERVAL_MS)
  }
}

type McpManagerGlobal = typeof globalThis & {
  _mcpConnectionManager?: McpConnectionManager | null
}

const _g = globalThis as McpManagerGlobal
if (!('_mcpConnectionManager' in _g)) {
  _g._mcpConnectionManager = isTest ? null : new McpConnectionManager()
}

export const mcpConnectionManager: McpConnectionManager | null = _g._mcpConnectionManager ?? null
