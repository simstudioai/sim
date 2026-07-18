import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError, getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { and, eq, gte, isNull, lt, lte, or } from 'drizzle-orm'
import { isTest } from '@/lib/core/config/env-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { McpClient } from '@/lib/mcp/client'
import { mcpConnectionManager } from '@/lib/mcp/connection-manager'
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
  type McpCacheMutationSet,
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

export function getTimestampMillisecondBounds(timestamp: string): {
  startInclusive: Date
  endExclusive: Date
} {
  const startInclusive = new Date(timestamp)
  return {
    startInclusive,
    endExclusive: new Date(startInclusive.getTime() + 1),
  }
}

const FAILURE_CACHE_SENTINEL: McpTool[] = []

type DiscoveryOutcome =
  | { kind: 'cached'; tools: McpTool[] }
  | {
      kind: 'fetched'
      tools: McpTool[]
      resolvedConfig: McpServerConfig
      resolvedIP: string | null
      mutation: CacheMutation | null
    }
  | { kind: 'oauth-pending'; config: McpServerConfig; mutation: CacheMutation | null }
  | { kind: 'unhealthy' }
  // originalError preserves the type so the OAuth exemption survives the
  // getErrorMessage call.
  | {
      kind: 'error'
      message: string
      originalError: unknown
      config: McpServerConfig
      mutation: CacheMutation | null
    }

interface CacheMutation {
  scopeKey: string
  id: number
}

type ServerStatusUpdate =
  | {
      outcome: 'connected'
      toolCount: number
      configUpdatedAt: string
      discoveryStartedAt: Date
    }
  | {
      outcome: 'failed'
      error: string
      configUpdatedAt: string
      discoveryStartedAt: Date
    }

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
  if (error instanceof StreamableHTTPError) {
    if (error.code === 401 || error.code === 403) return 'Authentication failed'
    if (error.code === 429) return 'The MCP server is rate limited. Try again shortly.'
    if (typeof error.code === 'number' && error.code >= 500) {
      return 'The MCP server is temporarily unavailable'
    }
  }
  const message = getErrorMessage(error, '').toLowerCase()
  if (
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('fetch failed') ||
    message.includes('network')
  ) {
    return 'Unable to reach the MCP server'
  }
  return fallback === 'Unknown error' ? 'Connection failed' : fallback
}

function getSafeErrorDiagnostics(error: unknown) {
  const described = describeError(error)
  return {
    name: described.name,
    code: described.code,
    errno: described.errno,
    syscall: described.syscall,
  }
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    return true
  }
  return getErrorMessage(error, '').toLowerCase().includes('timed out')
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
        this.invalidateServerCache(event.workspaceId, event.serverId).catch((error) => {
          logger.warn(`Failed to invalidate cache for ${event.serverName} on listChanged`, {
            error: getSafeErrorDiagnostics(error),
          })
        })
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

        const { config: resolvedConfig, resolvedIP } = await this.resolveConfigEnvVars(
          config,
          userId,
          workspaceId
        )
        if (extraHeaders && Object.keys(extraHeaders).length > 0) {
          resolvedConfig.headers = { ...resolvedConfig.headers, ...extraHeaders }
        }
        const client = await this.createClient(resolvedConfig, resolvedIP, userId)

        try {
          const result = await client.callTool(toolCall)
          logger.info(`[${requestId}] Successfully executed tool ${toolCall.name}`)
          return result
        } finally {
          await client.disconnect()
        }
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
      const configUpdatedAt = getTimestampMillisecondBounds(update.configUpdatedAt)
      const publicationConditions = and(
        eq(mcpServers.id, serverId),
        eq(mcpServers.workspaceId, workspaceId),
        isNull(mcpServers.deletedAt),
        gte(mcpServers.updatedAt, configUpdatedAt.startInclusive),
        lt(mcpServers.updatedAt, configUpdatedAt.endExclusive),
        or(
          isNull(mcpServers.lastToolsRefresh),
          lte(mcpServers.lastToolsRefresh, update.discoveryStartedAt)
        )
      )

      if (update.outcome === 'connected') {
        const updatedServers = await db
          .update(mcpServers)
          .set({
            connectionStatus: 'connected',
            lastConnected: now,
            lastError: null,
            toolCount: update.toolCount,
            // This column is also the publication ordering token. Persist the
            // discovery start (rather than finish) so a newer-started run can
            // still publish after an older run completes while it is in flight.
            lastToolsRefresh: update.discoveryStartedAt,
            statusConfig: {
              consecutiveFailures: 0,
              lastSuccessfulDiscovery: now.toISOString(),
            },
          })
          .where(publicationConditions)
          .returning({ id: mcpServers.id })
        return updatedServers.length > 0
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
          toolCount: 0,
          lastToolsRefresh: update.discoveryStartedAt,
          statusConfig: {
            consecutiveFailures: newFailures,
            lastSuccessfulDiscovery: currentConfig.lastSuccessfulDiscovery,
          },
        })
        .where(publicationConditions)
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

  private async applyServerCacheMutation(
    workspaceId: string,
    serverId: string,
    mutation: CacheMutation | null,
    setEntry: McpCacheMutationSet | null,
    deleteKeys: string[]
  ): Promise<boolean> {
    if (!mutation) return true
    try {
      return await this.cacheAdapter.applyMutationIfCurrent(
        mutation.scopeKey,
        mutation.id,
        setEntry,
        deleteKeys
      )
    } catch (error) {
      logger.warn(`Failed to atomically update cache for server ${serverId}`, {
        workspaceId,
        error: getSafeErrorDiagnostics(error),
      })
      return true
    }
  }

  private async markServerOauthPending(
    serverId: string,
    workspaceId: string,
    configUpdatedAt: string,
    discoveryStartedAt: Date
  ): Promise<boolean> {
    try {
      const configUpdatedAtBounds = getTimestampMillisecondBounds(configUpdatedAt)
      const updatedServers = await db
        .update(mcpServers)
        .set({
          connectionStatus: 'disconnected',
          lastError: null,
          toolCount: 0,
          lastToolsRefresh: discoveryStartedAt,
        })
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt),
            gte(mcpServers.updatedAt, configUpdatedAtBounds.startInclusive),
            lt(mcpServers.updatedAt, configUpdatedAtBounds.endExclusive),
            or(
              isNull(mcpServers.lastToolsRefresh),
              lte(mcpServers.lastToolsRefresh, discoveryStartedAt)
            )
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

  private async beginServerCacheMutation(
    workspaceId: string,
    serverId: string
  ): Promise<CacheMutation | null> {
    const scopeKey = serverCacheKey(workspaceId, serverId)
    try {
      return { scopeKey, id: await this.cacheAdapter.beginMutation(scopeKey) }
    } catch (error) {
      logger.warn(`Failed to order cache mutation for server ${serverId}`, {
        error: getSafeErrorDiagnostics(error),
      })
      return null
    }
  }

  private async invalidateServerCache(workspaceId: string, serverId: string): Promise<void> {
    const mutation = await this.beginServerCacheMutation(workspaceId, serverId)
    if (!mutation) return
    await this.applyServerCacheMutation(workspaceId, serverId, mutation, null, [
      serverCacheKey(workspaceId, serverId),
      failureCacheKey(workspaceId, serverId),
    ])
  }

  private async publishSuccessfulDiscovery(
    workspaceId: string,
    config: McpServerConfig,
    mutation: CacheMutation | null,
    tools: McpTool[],
    discoveryStartedAt: Date
  ): Promise<boolean> {
    const cacheApplied = await this.applyServerCacheMutation(
      workspaceId,
      config.id,
      mutation,
      {
        key: serverCacheKey(workspaceId, config.id),
        tools,
        ttlMs: this.cacheTimeout,
      },
      [failureCacheKey(workspaceId, config.id)]
    )
    if (!cacheApplied) return false

    const statusApplied = await this.updateServerStatus(config.id, workspaceId, {
      outcome: 'connected',
      toolCount: tools.length,
      configUpdatedAt: config.updatedAt!,
      discoveryStartedAt,
    })
    if (statusApplied) return true

    // A config change or newer discovery won the database CAS after the cache
    // mutation. Remove this result only if its mutation is still current; a
    // newer cache publisher must never be disturbed.
    await this.applyServerCacheMutation(workspaceId, config.id, mutation, null, [
      serverCacheKey(workspaceId, config.id),
      failureCacheKey(workspaceId, config.id),
    ])
    return false
  }

  private async publishFailedDiscovery(
    workspaceId: string,
    config: McpServerConfig,
    mutation: CacheMutation | null,
    error: unknown,
    message: string,
    discoveryStartedAt: Date
  ): Promise<boolean> {
    const cacheApplied = await this.applyServerCacheMutation(
      workspaceId,
      config.id,
      mutation,
      isOauthAuthorizationError(error, config.authType)
        ? null
        : {
            key: failureCacheKey(workspaceId, config.id),
            tools: FAILURE_CACHE_SENTINEL,
            ttlMs: MCP_CLIENT_CONSTANTS.FAILURE_CACHE_TTL_MS,
          },
      [serverCacheKey(workspaceId, config.id)]
    )
    if (!cacheApplied) return false

    const statusApplied = await this.updateServerStatus(config.id, workspaceId, {
      outcome: 'failed',
      error: message,
      configUpdatedAt: config.updatedAt!,
      discoveryStartedAt,
    })
    if (statusApplied) return true

    // Do not leave a negative-cache entry for a failure that lost the
    // database publication CAS.
    await this.applyServerCacheMutation(workspaceId, config.id, mutation, null, [
      failureCacheKey(workspaceId, config.id),
    ])
    return false
  }

  private async publishOauthPending(
    workspaceId: string,
    config: McpServerConfig,
    mutation: CacheMutation | null,
    discoveryStartedAt: Date
  ): Promise<boolean> {
    const cacheApplied = await this.applyServerCacheMutation(
      workspaceId,
      config.id,
      mutation,
      null,
      [serverCacheKey(workspaceId, config.id), failureCacheKey(workspaceId, config.id)]
    )
    if (!cacheApplied) return false

    return this.markServerOauthPending(
      config.id,
      workspaceId,
      config.updatedAt!,
      discoveryStartedAt
    )
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

          const mutation = await this.beginServerCacheMutation(workspaceId, config.id)

          try {
            const { config: resolvedConfig, resolvedIP } = await this.resolveConfigEnvVars(
              config,
              userId,
              workspaceId
            )
            const client = await this.createClient(resolvedConfig, resolvedIP, userId)
            try {
              const tools = await client.listTools()
              logger.debug(
                `[${requestId}] Discovered ${tools.length} tools from server ${config.name}`
              )
              return { kind: 'fetched', tools, resolvedConfig, resolvedIP, mutation }
            } finally {
              await client.disconnect()
            }
          } catch (error) {
            if (isOauthAuthorizationError(error, config.authType)) {
              return { kind: 'oauth-pending', config, mutation }
            }
            return {
              kind: 'error',
              message: getDiscoveryFailureMessage(error, config.authType, 'Unknown error'),
              originalError: error,
              config,
              mutation,
            }
          }
        })
      )

      const publications = await Promise.all(
        outcomes.map(async (outcome, index) => {
          const server = servers[index]
          if (outcome.kind === 'cached') {
            return {
              tools: outcome.tools,
              cached: 1,
              fetched: 0,
              failed: 0,
              liveConnection: null,
            }
          }
          if (outcome.kind === 'fetched') {
            const published = await this.publishSuccessfulDiscovery(
              workspaceId,
              outcome.resolvedConfig,
              outcome.mutation,
              outcome.tools,
              discoveryStartedAt
            )
            if (!published) {
              logger.info(
                `[${requestId}] Ignoring superseded discovery result for server ${server.id}`
              )
            }
            return {
              tools: published ? outcome.tools : [],
              cached: 0,
              fetched: 1,
              failed: published ? 0 : 1,
              liveConnection: published
                ? {
                    resolvedConfig: outcome.resolvedConfig,
                    resolvedIP: outcome.resolvedIP,
                  }
                : null,
            }
          }
          if (outcome.kind === 'oauth-pending') {
            logger.info(
              `[${requestId}] Skipping server ${server.name}: OAuth authorization pending`
            )
            await this.publishOauthPending(
              workspaceId,
              outcome.config,
              outcome.mutation,
              discoveryStartedAt
            )
            return { tools: [], cached: 0, fetched: 0, failed: 0, liveConnection: null }
          }
          if (outcome.kind === 'unhealthy') {
            return { tools: [], cached: 0, fetched: 0, failed: 1, liveConnection: null }
          }

          logger.warn(`[${requestId}] Failed to discover tools from server ${server.name}`, {
            error: outcome.message,
          })
          await this.publishFailedDiscovery(
            workspaceId,
            outcome.config,
            outcome.mutation,
            outcome.originalError,
            outcome.message,
            discoveryStartedAt
          )
          return { tools: [], cached: 0, fetched: 0, failed: 1, liveConnection: null }
        })
      )

      const allTools = publications.flatMap((publication) => publication.tools)
      const cachedCount = publications.reduce((sum, publication) => sum + publication.cached, 0)
      const fetchedCount = publications.reduce((sum, publication) => sum + publication.fetched, 0)
      const failedCount = publications.reduce((sum, publication) => sum + publication.failed, 0)
      const liveConnections = publications.flatMap((publication) =>
        publication.liveConnection ? [publication.liveConnection] : []
      )

      if (mcpConnectionManager) {
        for (const conn of liveConnections) {
          mcpConnectionManager
            .connect(conn.resolvedConfig, userId, workspaceId, conn.resolvedIP)
            .catch((err) => {
              logger.warn(
                `[${requestId}] Persistent connection failed for ${conn.resolvedConfig.name}:`,
                err
              )
            })
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

    const mutation = await this.beginServerCacheMutation(workspaceId, serverId)

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let config: McpServerConfig | null = null
      try {
        logger.info(
          `[${requestId}] Discovering tools from server ${serverId} for user ${userId}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`
        )

        config = await this.getServerConfig(serverId, workspaceId)
        if (!config) {
          throw new Error(`Server ${serverId} not found or not accessible`)
        }

        const { config: resolvedConfig, resolvedIP } = await this.resolveConfigEnvVars(
          config,
          userId,
          workspaceId
        )
        const client = await this.createClient(resolvedConfig, resolvedIP, userId)

        try {
          const tools = await client.listTools()
          logger.info(`[${requestId}] Discovered ${tools.length} tools from server ${config.name}`)
          const published = await this.publishSuccessfulDiscovery(
            workspaceId,
            resolvedConfig,
            mutation,
            tools,
            discoveryStartedAt
          )
          if (!published) {
            logger.info(
              `[${requestId}] Ignoring superseded discovery result for server ${serverId}`
            )
            return []
          }
          return tools
        } finally {
          await client.disconnect()
        }
      } catch (error) {
        if (isRetryableDiscoveryError(error) && attempt < maxRetries - 1) {
          logger.warn(
            `[${requestId}] Transient error discovering tools from server ${serverId}, retrying (attempt ${attempt + 1})`,
            { error: getSafeErrorDiagnostics(error) }
          )
          await sleep(backoffWithJitter(attempt + 1, null, { baseMs: 250, maxMs: 2000 }))
          continue
        }
        if (config) {
          if (isOauthAuthorizationError(error, config.authType)) {
            await this.publishOauthPending(workspaceId, config, mutation, discoveryStartedAt)
          } else {
            await this.publishFailedDiscovery(
              workspaceId,
              config,
              mutation,
              error,
              getDiscoveryFailureMessage(error, config.authType, 'Connection failed'),
              discoveryStartedAt
            )
          }
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
          const { config: resolvedConfig, resolvedIP } = await this.resolveConfigEnvVars(
            config,
            userId,
            workspaceId
          )
          const client = await this.createClient(resolvedConfig, resolvedIP, userId)
          const tools = await client.listTools()
          await client.disconnect()

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
        await Promise.allSettled(rows.map((row) => this.invalidateServerCache(workspaceId, row.id)))
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
