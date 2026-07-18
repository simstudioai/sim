import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { and, eq, isNull, lte, or } from 'drizzle-orm'
import { isTest } from '@/lib/core/config/env-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { McpClient } from '@/lib/mcp/client'
import { mcpConnectionManager } from '@/lib/mcp/connection-manager'
import { mcpConnectionPool } from '@/lib/mcp/connection-pool'
import {
  isMcpDomainAllowed,
  validateMcpDomain,
  validateMcpServerSsrf,
} from '@/lib/mcp/domain-check'
import {
  getOrCreateOauthRow,
  loadPreregisteredClient,
  SimMcpOauthProvider,
  withMcpOauthRefreshLock,
} from '@/lib/mcp/oauth'
import { resolveMcpConfigEnvVars } from '@/lib/mcp/resolve-config'
import {
  createMcpCacheAdapter,
  getMcpCacheType,
  type McpCacheStorageAdapter,
} from '@/lib/mcp/storage'
import {
  McpConnectionError,
  McpOauthAuthorizationRequiredError,
  type McpServerConfig,
  type McpServerStatusConfig,
  type McpServerSummary,
  type McpTool,
  type McpToolCall,
  type McpToolResult,
  type McpTransport,
} from '@/lib/mcp/types'
import { MCP_CLIENT_CONSTANTS, MCP_CONSTANTS } from '@/lib/mcp/utils'

const logger = createLogger('McpService')

function serverCacheKey(workspaceId: string, serverId: string): string {
  return `workspace:${workspaceId}:server:${serverId}`
}

function failureCacheKey(workspaceId: string, serverId: string): string {
  return `workspace:${workspaceId}:server:${serverId}:failure`
}

const FAILURE_CACHE_SENTINEL: McpTool[] = []

type DiscoveryOutcome =
  | { kind: 'cached'; tools: McpTool[] }
  | { kind: 'fetched'; tools: McpTool[] }
  | { kind: 'oauth-pending' }
  | { kind: 'unhealthy' }
  // originalError preserves the type so markServerUnhealthy's instanceof
  // exemption survives the getErrorMessage call.
  | { kind: 'error'; message: string; originalError: unknown }

type ServerStatusUpdate =
  | { outcome: 'connected'; toolCount: number }
  | { outcome: 'failed'; error: string; discoveryStartedAt?: Date }

function isOauthAuthorizationError(error: unknown, authType: McpServerConfig['authType']): boolean {
  return (
    error instanceof McpOauthAuthorizationRequiredError ||
    (authType === 'oauth' && error instanceof UnauthorizedError)
  )
}

function getDiscoveryFailureMessage(
  error: unknown,
  authType: McpServerConfig['authType'],
  fallback: string
): string {
  if (authType !== 'oauth' && error instanceof UnauthorizedError) {
    return 'Authentication failed'
  }
  if (isTimeoutError(error)) {
    return 'The MCP server took too long to respond and timed out'
  }
  return getErrorMessage(error, fallback)
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    return true
  }
  return getErrorMessage(error, '').toLowerCase().includes('timed out')
}

/**
 * A pooled connection is dead and must be retired so the caller's retry rebuilds
 * fresh: a stale session (400/404), an auth failure (401 — a rotated/revoked
 * credential; the rebuild re-resolves it), a closed transport, a timeout (no
 * response — possibly wedged), or a reset socket. Benign tool/consent errors and
 * healthy upstream responses (429/5xx) keep the connection warm.
 */
function isDeadConnectionError(error: unknown): boolean {
  if (error instanceof UnauthorizedError) {
    return true
  }
  if (error instanceof StreamableHTTPError) {
    return error.code === 404 || error.code === 400 || error.code === 401
  }
  if (error instanceof McpError && error.code === ErrorCode.ConnectionClosed) {
    return true
  }
  if (isTimeoutError(error)) {
    return true
  }
  const message = getErrorMessage(error, '').toLowerCase()
  return (
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('epipe') ||
    message.includes('socket hang up')
  )
}

/** Transient failures a read-only `tools/list` may safely retry (idempotent, unlike `tools/call`); excludes OAuth and terminal 4xx. */
function isRetryableDiscoveryError(error: unknown): boolean {
  if (isTimeoutError(error)) return true
  if (error instanceof McpError) {
    return error.code === ErrorCode.ConnectionClosed
  }
  if (error instanceof StreamableHTTPError) {
    // 404/400 = stale session (retry re-initializes); 429/5xx = transient upstream.
    const code = error.code
    return (
      code === 404 ||
      code === 400 ||
      code === 429 ||
      (typeof code === 'number' && code >= 500 && code <= 599)
    )
  }
  const message = getErrorMessage(error, '').toLowerCase()
  return (
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('etimedout') ||
    message.includes('fetch failed') ||
    message.includes('network')
  )
}

class McpService {
  private cacheAdapter: McpCacheStorageAdapter
  private readonly cacheTimeout = MCP_CONSTANTS.CACHE_TIMEOUT
  private unsubscribeConnectionManager?: () => void
  // Keyed on (workspaceId, serverId, userId) — OAuth-scoped tokens vary per user.
  private inflightServerDiscovery = new Map<string, Promise<McpTool[]>>()

  constructor() {
    this.cacheAdapter = createMcpCacheAdapter()
    logger.info(`MCP Service initialized with ${getMcpCacheType()} cache`)

    if (mcpConnectionManager) {
      this.unsubscribeConnectionManager = mcpConnectionManager.subscribe((event) => {
        this.cacheAdapter
          .delete(serverCacheKey(event.workspaceId, event.serverId))
          .catch((err) =>
            logger.warn(`Failed to invalidate cache for ${event.serverName} on listChanged:`, err)
          )
        this.cacheAdapter
          .delete(failureCacheKey(event.workspaceId, event.serverId))
          .catch((err) =>
            logger.warn(
              `Failed to invalidate failure cache for ${event.serverName} on listChanged:`,
              err
            )
          )
      })
    }
  }

  dispose(): void {
    this.unsubscribeConnectionManager?.()
    this.cacheAdapter.dispose()
    logger.info('MCP Service disposed')
  }

  private async resolveConfigEnvVars(
    config: McpServerConfig,
    userId: string,
    workspaceId?: string
  ): Promise<{ config: McpServerConfig; resolvedIP: string | null }> {
    const { config: resolvedConfig } = await resolveMcpConfigEnvVars(config, userId, workspaceId, {
      strict: true,
    })
    validateMcpDomain(resolvedConfig.url)
    const resolvedIP = await validateMcpServerSsrf(resolvedConfig.url)
    return { config: resolvedConfig, resolvedIP }
  }

  private async getServerConfig(
    serverId: string,
    workspaceId: string
  ): Promise<McpServerConfig | null> {
    const [server] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, serverId),
          eq(mcpServers.workspaceId, workspaceId),
          eq(mcpServers.enabled, true),
          isNull(mcpServers.deletedAt)
        )
      )
      .limit(1)

    if (!server) {
      return null
    }

    if (!isMcpDomainAllowed(server.url || undefined)) {
      return null
    }

    return {
      id: server.id,
      name: server.name,
      description: server.description || undefined,
      transport: 'streamable-http' as const,
      url: server.url || undefined,
      authType: (server.authType as McpServerConfig['authType']) ?? 'headers',
      workspaceId: server.workspaceId,
      headers: (server.headers as Record<string, string>) || {},
      timeout: server.timeout || 30000,
      retries: server.retries || 3,
      enabled: server.enabled,
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
    }
  }

  private async getWorkspaceServers(workspaceId: string): Promise<McpServerConfig[]> {
    const whereConditions = [
      eq(mcpServers.workspaceId, workspaceId),
      eq(mcpServers.enabled, true),
      isNull(mcpServers.deletedAt),
    ]

    const servers = await db
      .select()
      .from(mcpServers)
      .where(and(...whereConditions))

    return servers
      .map((server) => ({
        id: server.id,
        name: server.name,
        description: server.description || undefined,
        transport: server.transport as McpTransport,
        url: server.url || undefined,
        authType: (server.authType as McpServerConfig['authType']) ?? 'headers',
        workspaceId: server.workspaceId,
        headers: (server.headers as Record<string, string>) || {},
        timeout: server.timeout || 30000,
        retries: server.retries || 3,
        enabled: server.enabled,
        createdAt: server.createdAt.toISOString(),
        updatedAt: server.updatedAt.toISOString(),
      }))
      .filter((config) => isMcpDomainAllowed(config.url))
  }

  private async createClient(
    config: McpServerConfig,
    resolvedIP: string | null,
    userId?: string
  ): Promise<McpClient> {
    const securityPolicy = {
      requireConsent: true,
      auditLevel: 'basic' as const,
      maxToolExecutionsPerHour: 1000,
      allowedOrigins: config.url ? [new URL(config.url).origin] : undefined,
    }

    if (config.authType !== 'oauth') {
      const client = new McpClient({
        config,
        securityPolicy,
        resolvedIP: resolvedIP ?? undefined,
      })
      await client.connect()
      return client
    }

    if (!userId || !config.workspaceId) {
      throw new Error('OAuth MCP server requires both userId and workspaceId')
    }
    const workspaceId = config.workspaceId

    // Load the row inside the refresh lock so concurrent callers observe tokens
    // written by a predecessor refresh, rather than a stale snapshot. Without
    // this, the second caller's provider would hold a rotated-out refresh token
    // and the SDK would trip `invalid_grant`. The lock is keyed on serverId
    // since the row is per-server.
    return withMcpOauthRefreshLock(config.id, async () => {
      const row = await getOrCreateOauthRow({
        mcpServerId: config.id,
        userId,
        workspaceId,
      })
      if (!row.tokens) {
        throw new McpOauthAuthorizationRequiredError(config.id, config.name)
      }
      const preregistered = await loadPreregisteredClient(config.id)
      const authProvider = new SimMcpOauthProvider({ row, preregistered })
      const client = new McpClient({
        config,
        securityPolicy,
        authProvider,
        resolvedIP: resolvedIP ?? undefined,
      })
      await client.connect()
      return client
    })
  }

  /** Auth-scoped pool key: a server's resolved credentials depend on the (user, workspace) env. */
  private poolKey(
    serverId: string,
    workspaceId: string | undefined,
    userId: string | undefined
  ): string {
    return `${serverId}:${workspaceId ?? ''}:${userId ?? ''}`
  }

  /**
   * Run `fn` against a connected client. When `allowPool`, borrow from the warm
   * pool (`create` runs only on a miss, so a hit skips env resolution + DNS); a
   * dead-connection error retires it, benign tool/consent errors keep it warm.
   * Otherwise connect one-shot and always disconnect.
   */
  private async withServerClient<T>(
    opts: { key: string; serverId: string; allowPool: boolean },
    create: () => Promise<McpClient>,
    fn: (client: McpClient) => Promise<T>
  ): Promise<T> {
    const pool = mcpConnectionPool
    if (opts.allowPool && pool) {
      const lease = await pool.acquire({
        key: opts.key,
        serverId: opts.serverId,
        create,
      })
      let poison = false
      try {
        return await fn(lease.client)
      } catch (error) {
        poison = isDeadConnectionError(error)
        throw error
      } finally {
        await lease.release(poison)
      }
    }

    const client = await create()
    try {
      return await fn(client)
    } finally {
      await client.disconnect()
    }
  }

  /**
   * Execute a tool on a specific server with retry logic for session errors.
   * Retries once on session-related errors (400, 404, session ID issues).
   */
  async executeTool(
    userId: string,
    serverId: string,
    toolCall: McpToolCall,
    workspaceId: string,
    extraHeaders?: Record<string, string>
  ): Promise<McpToolResult> {
    const requestId = generateRequestId()
    const maxRetries = 2

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        logger.info(
          `[${requestId}] Executing MCP tool ${toolCall.name} on server ${serverId} for user ${userId}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`
        )

        const config = await this.getServerConfig(serverId, workspaceId)
        if (!config) {
          throw new Error(`Server ${serverId} not found or not accessible`)
        }

        const hasExtraHeaders = Boolean(extraHeaders && Object.keys(extraHeaders).length > 0)
        const create = async () => {
          const { config: resolvedConfig, resolvedIP } = await this.resolveConfigEnvVars(
            config,
            userId,
            workspaceId
          )
          if (hasExtraHeaders) {
            resolvedConfig.headers = { ...resolvedConfig.headers, ...extraHeaders }
          }
          return this.createClient(resolvedConfig, resolvedIP, userId)
        }

        const result = await this.withServerClient(
          {
            key: this.poolKey(serverId, workspaceId, userId),
            serverId,
            allowPool: !hasExtraHeaders,
          },
          create,
          (client) => client.callTool(toolCall)
        )
        logger.info(`[${requestId}] Successfully executed tool ${toolCall.name}`)
        return result
      } catch (error) {
        if (this.isSessionError(error) && attempt < maxRetries - 1) {
          logger.warn(
            `[${requestId}] Session error executing tool ${toolCall.name}, retrying (attempt ${attempt + 1}):`,
            error
          )
          await sleep(100)
          continue
        }
        throw error
      }
    }

    throw new Error(`Failed to execute tool ${toolCall.name} after ${maxRetries} attempts`)
  }

  /** MCP spec: server returns 404 for unknown session id, 400 for malformed header. */
  private isSessionError(error: unknown): boolean {
    if (error instanceof StreamableHTTPError) {
      return error.code === 404 || error.code === 400
    }
    return false
  }

  private async updateServerStatus(
    serverId: string,
    workspaceId: string,
    update: ServerStatusUpdate
  ): Promise<boolean> {
    try {
      const now = new Date()

      if (update.outcome === 'connected') {
        await db
          .update(mcpServers)
          .set({
            connectionStatus: 'connected',
            lastConnected: now,
            lastError: null,
            toolCount: update.toolCount,
            lastToolsRefresh: now,
            statusConfig: {
              consecutiveFailures: 0,
              lastSuccessfulDiscovery: now.toISOString(),
            },
            updatedAt: now,
          })
          .where(eq(mcpServers.id, serverId))
        return true
      }

      const [currentServer] = await db
        .select({ statusConfig: mcpServers.statusConfig })
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)

      const storedConfig = currentServer?.statusConfig as Partial<McpServerStatusConfig> | null
      const currentConfig: McpServerStatusConfig = {
        consecutiveFailures:
          typeof storedConfig?.consecutiveFailures === 'number'
            ? storedConfig.consecutiveFailures
            : 0,
        lastSuccessfulDiscovery: storedConfig?.lastSuccessfulDiscovery ?? null,
      }

      const newFailures = currentConfig.consecutiveFailures + 1
      const isErrorState = newFailures >= MCP_CONSTANTS.MAX_CONSECUTIVE_FAILURES

      const updatedServers = await db
        .update(mcpServers)
        .set({
          connectionStatus: isErrorState ? 'error' : 'disconnected',
          lastError: update.error || 'Unknown error',
          statusConfig: {
            consecutiveFailures: newFailures,
            lastSuccessfulDiscovery: currentConfig.lastSuccessfulDiscovery,
          },
          updatedAt: now,
        })
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt),
            update.discoveryStartedAt
              ? or(
                  isNull(mcpServers.lastConnected),
                  lte(mcpServers.lastConnected, update.discoveryStartedAt)
                )
              : undefined
          )
        )
        .returning({ id: mcpServers.id })

      if (isErrorState && updatedServers.length > 0) {
        logger.warn(`Server ${serverId} marked as error after ${newFailures} consecutive failures`)
      }
      return updatedServers.length > 0
    } catch (err) {
      logger.error(`Failed to update server status for ${serverId}:`, err)
      return false
    }
  }

  /**
   * Negative-cache a discovery failure. OAuth-required errors are exempt so
   * reconnects retry immediately.
   */
  private async markServerUnhealthy(
    workspaceId: string,
    serverId: string,
    error: unknown,
    authType: McpServerConfig['authType']
  ): Promise<void> {
    if (isOauthAuthorizationError(error, authType)) {
      return
    }
    try {
      await this.cacheAdapter.set(
        failureCacheKey(workspaceId, serverId),
        FAILURE_CACHE_SENTINEL,
        MCP_CLIENT_CONSTANTS.FAILURE_CACHE_TTL_MS
      )
    } catch (err) {
      logger.warn(`Failed to write failure cache for server ${serverId}:`, err)
    }
  }

  private async markServerOauthPending(
    serverId: string,
    workspaceId: string,
    discoveryStartedAt?: Date
  ): Promise<boolean> {
    try {
      const updatedServers = await db
        .update(mcpServers)
        .set({
          connectionStatus: 'disconnected',
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt),
            discoveryStartedAt
              ? or(
                  isNull(mcpServers.lastConnected),
                  lte(mcpServers.lastConnected, discoveryStartedAt)
                )
              : undefined
          )
        )
        .returning({ id: mcpServers.id })
      return updatedServers.length > 0
    } catch (error) {
      logger.warn(`Failed to mark OAuth server ${serverId} disconnected:`, error)
      return false
    }
  }

  private async isServerUnhealthy(workspaceId: string, serverId: string): Promise<boolean> {
    try {
      const entry = await this.cacheAdapter.get(failureCacheKey(workspaceId, serverId))
      return entry !== null
    } catch {
      return false
    }
  }

  private async clearServerFailure(workspaceId: string, serverId: string): Promise<void> {
    try {
      await this.cacheAdapter.delete(failureCacheKey(workspaceId, serverId))
    } catch (err) {
      logger.warn(`Failed to clear failure cache for server ${serverId}:`, err)
    }
  }

  async discoverTools(
    userId: string,
    workspaceId: string,
    forceRefresh = false
  ): Promise<McpTool[]> {
    const requestId = generateRequestId()
    const discoveryStartedAt = new Date()

    try {
      logger.info(`[${requestId}] Discovering MCP tools for workspace ${workspaceId}`)

      const servers = await this.getWorkspaceServers(workspaceId)

      if (servers.length === 0) {
        logger.info(`[${requestId}] No servers found for workspace ${workspaceId}`)
        return []
      }

      const outcomes = await Promise.all(
        servers.map(async (config): Promise<DiscoveryOutcome> => {
          const cacheKey = serverCacheKey(workspaceId, config.id)

          if (!forceRefresh) {
            try {
              const cached = await this.cacheAdapter.get(cacheKey)
              if (cached) return { kind: 'cached', tools: cached.tools }
            } catch (error) {
              logger.warn(
                `[${requestId}] Cache read failed for ${config.name}, proceeding with discovery:`,
                error
              )
            }
            if (await this.isServerUnhealthy(workspaceId, config.id)) {
              logger.info(
                `[${requestId}] Skipping recently-failed server ${config.name} (negative-cache hit)`
              )
              return { kind: 'unhealthy' }
            }
          }

          try {
            const create = async () => {
              const { config: resolvedConfig, resolvedIP } = await this.resolveConfigEnvVars(
                config,
                userId,
                workspaceId
              )
              return this.createClient(resolvedConfig, resolvedIP, userId)
            }
            const tools = await this.withServerClient(
              {
                key: this.poolKey(config.id, workspaceId, userId),
                serverId: config.id,
                allowPool: true,
              },
              create,
              (client) => client.listTools()
            )
            logger.debug(
              `[${requestId}] Discovered ${tools.length} tools from server ${config.name}`
            )
            return { kind: 'fetched', tools }
          } catch (error) {
            if (isOauthAuthorizationError(error, config.authType)) {
              return { kind: 'oauth-pending' }
            }
            return {
              kind: 'error',
              message: getDiscoveryFailureMessage(error, config.authType, 'Unknown error'),
              originalError: error,
            }
          }
        })
      )

      const allTools: McpTool[] = []
      const cacheWrites: Promise<unknown>[] = []
      const deferredSideEffects: Promise<unknown>[] = []
      const liveConnections: McpServerConfig[] = []
      let cachedCount = 0
      let fetchedCount = 0
      let failedCount = 0

      outcomes.forEach((outcome, index) => {
        const server = servers[index]
        if (outcome.kind === 'cached') {
          cachedCount++
          allTools.push(...outcome.tools)
          return
        }
        if (outcome.kind === 'fetched') {
          fetchedCount++
          allTools.push(...outcome.tools)
          deferredSideEffects.push(
            this.updateServerStatus(server.id, workspaceId, {
              outcome: 'connected',
              toolCount: outcome.tools.length,
            })
          )
          cacheWrites.push(
            this.cacheAdapter
              .set(serverCacheKey(workspaceId, server.id), outcome.tools, this.cacheTimeout)
              .catch((err) =>
                logger.warn(`[${requestId}] Cache write failed for ${server.name}:`, err)
              )
          )
          deferredSideEffects.push(this.clearServerFailure(workspaceId, server.id))
          liveConnections.push(server)
          return
        }
        if (outcome.kind === 'oauth-pending') {
          // Mark disconnected so the UI surfaces the re-auth button.
          logger.info(`[${requestId}] Skipping server ${server.name}: OAuth authorization pending`)
          deferredSideEffects.push(
            this.markServerOauthPending(server.id, workspaceId, discoveryStartedAt).then(
              () => undefined
            )
          )
          return
        }
        if (outcome.kind === 'unhealthy') {
          // Status was persisted on the original failure; nothing to re-write.
          failedCount++
          return
        }
        failedCount++
        logger.warn(
          `[${requestId}] Failed to discover tools from server ${server.name}: ${outcome.message}`
        )
        deferredSideEffects.push(
          this.updateServerStatus(server.id, workspaceId, {
            outcome: 'failed',
            error: outcome.message,
            discoveryStartedAt,
          }).then(async (statusApplied) => {
            if (!statusApplied) return
            await Promise.allSettled([
              this.markServerUnhealthy(
                workspaceId,
                server.id,
                outcome.originalError,
                server.authType
              ),
              this.cacheAdapter
                .delete(serverCacheKey(workspaceId, server.id))
                .catch((err) =>
                  logger.warn(`[${requestId}] Cache delete failed for ${server.name}:`, err)
                ),
            ])
          })
        )
      })

      // Await cache writes so a follow-up discoverTools sees consistent state.
      await Promise.allSettled(cacheWrites)
      // Each deferred side-effect self-logs failures, so we just mark the
      // promises as handled to avoid unhandled-rejection warnings.
      for (const p of deferredSideEffects) p.catch(() => {})

      if (mcpConnectionManager) {
        const manager = mcpConnectionManager
        for (const config of liveConnections) {
          // Resolve only for servers the manager isn't already monitoring — a
          // pooled `listTools` hit above no longer resolves, so this is the sole
          // remaining resolution cost, and it's skipped in the steady state.
          if (manager.hasConnection(config.id)) continue
          void (async () => {
            try {
              const { config: resolvedConfig, resolvedIP } = await this.resolveConfigEnvVars(
                config,
                userId,
                workspaceId
              )
              await manager.connect(resolvedConfig, userId, workspaceId, resolvedIP)
            } catch (err) {
              logger.warn(`[${requestId}] Persistent connection failed for ${config.name}:`, err)
            }
          })()
        }
      }

      logger.info(
        `[${requestId}] Discovered ${allTools.length} tools from ${servers.length} servers (cached=${cachedCount} fetched=${fetchedCount} failed=${failedCount})`
      )
      return allTools
    } catch (error) {
      logger.error(`[${requestId}] Failed to discover MCP tools for user ${userId}:`, error)
      throw error
    }
  }

  /**
   * Discover tools from one server. Cache-aside by default; pass
   * `forceRefresh: true` from explicit-refresh paths (refresh button, OAuth
   * callback) to bypass both positive and negative caches. Concurrent callers
   * for the same `(workspaceId, serverId, userId, forceRefresh)` share one
   * upstream request.
   */
  async discoverServerTools(
    userId: string,
    serverId: string,
    workspaceId: string,
    forceRefresh = false
  ): Promise<McpTool[]> {
    const inflightKey = `${workspaceId}:${serverId}:${userId}:${forceRefresh ? 'force' : 'cache'}`
    const existing = this.inflightServerDiscovery.get(inflightKey)
    if (existing) return existing

    const promise = this.discoverServerToolsImpl(
      userId,
      serverId,
      workspaceId,
      forceRefresh
    ).finally(() => {
      this.inflightServerDiscovery.delete(inflightKey)
    })
    this.inflightServerDiscovery.set(inflightKey, promise)
    return promise
  }

  private async discoverServerToolsImpl(
    userId: string,
    serverId: string,
    workspaceId: string,
    forceRefresh: boolean
  ): Promise<McpTool[]> {
    const requestId = generateRequestId()
    const discoveryStartedAt = new Date()
    const maxRetries = 2

    if (!forceRefresh) {
      try {
        const cached = await this.cacheAdapter.get(serverCacheKey(workspaceId, serverId))
        if (cached) {
          logger.debug(`[${requestId}] Cache hit for server ${serverId}`)
          return cached.tools
        }
      } catch (error) {
        logger.warn(`[${requestId}] Cache read failed for server ${serverId}:`, error)
      }
      if (await this.isServerUnhealthy(workspaceId, serverId)) {
        logger.info(`[${requestId}] Skipping recently-failed server ${serverId} (negative-cache)`)
        throw new McpConnectionError(
          'Server recently failed and is in cooldown — try again shortly.',
          serverId
        )
      }
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let authType: McpServerConfig['authType']
      try {
        logger.info(
          `[${requestId}] Discovering tools from server ${serverId} for user ${userId}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`
        )

        const config = await this.getServerConfig(serverId, workspaceId)
        if (!config) {
          throw new Error(`Server ${serverId} not found or not accessible`)
        }
        authType = config.authType

        const create = async () => {
          const { config: resolvedConfig, resolvedIP } = await this.resolveConfigEnvVars(
            config,
            userId,
            workspaceId
          )
          return this.createClient(resolvedConfig, resolvedIP, userId)
        }
        const tools = await this.withServerClient(
          {
            key: this.poolKey(serverId, workspaceId, userId),
            serverId,
            allowPool: true,
          },
          create,
          (client) => client.listTools()
        )
        logger.info(`[${requestId}] Discovered ${tools.length} tools from server ${config.name}`)
        await Promise.allSettled([
          this.cacheAdapter
            .set(serverCacheKey(workspaceId, serverId), tools, this.cacheTimeout)
            .catch((err) =>
              logger.warn(`[${requestId}] Cache write failed for ${config.name}:`, err)
            ),
          this.clearServerFailure(workspaceId, serverId),
          this.updateServerStatus(serverId, workspaceId, {
            outcome: 'connected',
            toolCount: tools.length,
          }),
        ])
        return tools
      } catch (error) {
        if (isRetryableDiscoveryError(error) && attempt < maxRetries - 1) {
          logger.warn(
            `[${requestId}] Transient error discovering tools from server ${serverId}, retrying (attempt ${attempt + 1}):`,
            error
          )
          await sleep(backoffWithJitter(attempt + 1, null, { baseMs: 250, maxMs: 2000 }))
          continue
        }
        // Drop positive cache so a follow-up doesn't return stale tools.
        const statusApplied = isOauthAuthorizationError(error, authType)
          ? await this.markServerOauthPending(serverId, workspaceId, discoveryStartedAt)
          : await this.updateServerStatus(serverId, workspaceId, {
              outcome: 'failed',
              error: getDiscoveryFailureMessage(error, authType, 'Connection failed'),
              discoveryStartedAt,
            })
        if (statusApplied) {
          await Promise.allSettled([
            this.cacheAdapter
              .delete(serverCacheKey(workspaceId, serverId))
              .catch((err) =>
                logger.warn(`[${requestId}] Cache delete failed for ${serverId}:`, err)
              ),
            this.markServerUnhealthy(workspaceId, serverId, error, authType),
          ])
        }
        throw error
      }
    }

    throw new Error(`Failed to discover tools from server ${serverId} after ${maxRetries} attempts`)
  }

  async getServerSummaries(userId: string, workspaceId: string): Promise<McpServerSummary[]> {
    const requestId = generateRequestId()

    try {
      logger.info(`[${requestId}] Getting server summaries for workspace ${workspaceId}`)

      const servers = await this.getWorkspaceServers(workspaceId)
      const summaries: McpServerSummary[] = []

      for (const config of servers) {
        try {
          const create = async () => {
            const { config: resolvedConfig, resolvedIP } = await this.resolveConfigEnvVars(
              config,
              userId,
              workspaceId
            )
            return this.createClient(resolvedConfig, resolvedIP, userId)
          }
          const tools = await this.withServerClient(
            {
              key: this.poolKey(config.id, workspaceId, userId),
              serverId: config.id,
              allowPool: true,
            },
            create,
            (client) => client.listTools()
          )

          summaries.push({
            id: config.id,
            name: config.name,
            url: config.url,
            transport: config.transport,
            status: 'connected',
            toolCount: tools.length,
            lastSeen: new Date(),
            error: undefined,
          })
        } catch (error) {
          if (isOauthAuthorizationError(error, config.authType)) {
            summaries.push({
              id: config.id,
              name: config.name,
              url: config.url,
              transport: config.transport,
              status: 'disconnected',
              toolCount: 0,
              lastSeen: undefined,
              error: undefined,
            })
            continue
          }
          summaries.push({
            id: config.id,
            name: config.name,
            url: config.url,
            transport: config.transport,
            status: 'error',
            toolCount: 0,
            lastSeen: undefined,
            error: getDiscoveryFailureMessage(error, config.authType, 'Connection failed'),
          })
        }
      }

      return summaries
    } catch (error) {
      logger.error(`[${requestId}] Failed to get server summaries for user ${userId}:`, error)
      throw error
    }
  }

  async clearCache(workspaceId?: string): Promise<void> {
    try {
      if (workspaceId) {
        // No enabled/deletedAt filter so disabled and soft-deleted rows are
        // cleared too. Hard-deleted rows are gone from the table; their keys
        // expire via TTL.
        const rows = await db
          .select({ id: mcpServers.id })
          .from(mcpServers)
          .where(eq(mcpServers.workspaceId, workspaceId))
        await Promise.allSettled(
          rows.flatMap((r) => [
            this.cacheAdapter.delete(serverCacheKey(workspaceId, r.id)),
            this.cacheAdapter.delete(failureCacheKey(workspaceId, r.id)),
            mcpConnectionPool?.evictServer(r.id, 'cache cleared'),
          ])
        )
        logger.debug(`Cleared MCP tool cache for workspace ${workspaceId} (${rows.length} servers)`)
      } else {
        await this.cacheAdapter.clear()
        logger.debug('Cleared all MCP tool cache')
      }
    } catch (error) {
      logger.warn('Failed to clear cache:', error)
    }
  }
}

export const mcpService = new McpService()

/**
 * Setup process signal handlers for graceful shutdown
 */
export function setupMcpServiceCleanup() {
  if (isTest) {
    return
  }

  const cleanup = () => {
    mcpService.dispose()
  }

  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)

  return () => {
    process.removeListener('SIGTERM', cleanup)
    process.removeListener('SIGINT', cleanup)
  }
}
