import {
  type OAuthClientProvider,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { truncate } from '@sim/utils/string'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { McpClient } from '@/lib/mcp/client'
import { mcpConnectionManager } from '@/lib/mcp/connection-manager'
import { evictMcpServerConnections, mcpConnectionPool } from '@/lib/mcp/connection-pool'
import { MAX_MCP_LAST_ERROR_LENGTH } from '@/lib/mcp/constants'
import {
  isMcpDomainAllowed,
  validateMcpDomain,
  validateMcpServerSsrf,
} from '@/lib/mcp/domain-check'
import { getOrCreateOauthRow, loadPreregisteredClient, SimMcpOauthProvider } from '@/lib/mcp/oauth'
import type { McpOauthCredentials } from '@/lib/mcp/oauth/coordinated-fetch'
import { resolveMcpConfigEnvVars } from '@/lib/mcp/resolve-config'
import {
  createMcpCacheAdapter,
  getMcpCacheType,
  type McpCacheStorageAdapter,
} from '@/lib/mcp/storage'
import {
  McpOauthAuthorizationRequiredError,
  type McpServerConfig,
  McpServerCooldownError,
  type McpServerStatusConfig,
  type McpServerSummary,
  type McpTool,
  type McpToolCall,
  type McpToolResult,
  type McpTransport,
} from '@/lib/mcp/types'
import { MCP_CLIENT_CONSTANTS, MCP_CONSTANTS } from '@/lib/mcp/utils'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'
import {
  isResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceProvenanceV1,
} from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('McpService')

function serverCacheKey(workspaceId: string, serverId: string): string {
  return `workspace:${workspaceId}:server:${serverId}`
}

function failureCacheKey(workspaceId: string, serverId: string): string {
  return `workspace:${workspaceId}:server:${serverId}:failure`
}

const FAILURE_CACHE_SENTINEL: McpTool[] = []

type ResolvedSecretTraceProvenanceCallback = (provenance: ResolvedSecretTraceProvenanceV1) => void

interface McpRequestOptions {
  signal?: AbortSignal
  requireComplete?: boolean
}

interface McpToolExecutionOptions extends McpRequestOptions {
  timeoutMs?: number
}

function reportRetainedClientProvenance(
  provenance: unknown,
  userId: string,
  workspaceId: string,
  callback?: ResolvedSecretTraceProvenanceCallback
): void {
  if (!callback) return
  callback(
    isResolvedSecretTraceProvenanceV1(provenance)
      ? provenance
      : {
          version: 1,
          complete: false,
          entries: [],
          scope: { userId, workspaceId },
        }
  )
}

function isSameProvenance(
  left: ResolvedSecretTraceProvenanceV1,
  right: ResolvedSecretTraceProvenanceV1
): boolean {
  if (
    left.complete !== right.complete ||
    left.scope?.userId !== right.scope?.userId ||
    left.scope?.workspaceId !== right.scope?.workspaceId ||
    left.entries.length !== right.entries.length
  ) {
    return false
  }

  return left.entries.every((entry, index) => {
    const other = right.entries[index]
    return entry.name === other.name && entry.encryptedValue === other.encryptedValue
  })
}

function createInvocationProvenanceReporter(
  callback?: ResolvedSecretTraceProvenanceCallback
): ResolvedSecretTraceProvenanceCallback | undefined {
  if (!callback) return undefined

  let lastReported: ResolvedSecretTraceProvenanceV1 | undefined
  return (provenance) => {
    if (lastReported && isSameProvenance(lastReported, provenance)) return
    lastReported = provenance
    callback(provenance)
  }
}

/**
 * How far a discovery may bypass the caches.
 *
 * - `cache-aside` — serve the 5-minute positive cache, and honour the failure
 *   cooldown. The default for every incidental read.
 * - `skip-cache` — re-fetch even on a cache hit, but still honour the failure
 *   cooldown. This is what a public `refresh=true` gets: a caller asking for
 *   fresh tools should not also be able to drive a connection attempt per
 *   request at an endpoint already known to be failing, from Sim's egress
 *   addresses.
 * - `force` — bypass both. Reserved for an explicit user action on their own
 *   server (the refresh button, the OAuth callback), where the whole point is
 *   that the credential or endpoint has just been fixed and the cooldown would
 *   only delay the recovery the user is watching for.
 */
export type McpDiscoveryRefresh = 'cache-aside' | 'skip-cache' | 'force'

type DiscoveryOutcome =
  | { kind: 'cached'; tools: McpTool[] }
  | { kind: 'fetched'; tools: McpTool[] }
  | { kind: 'oauth-pending' }
  | { kind: 'unhealthy' }
  // originalError preserves the type so markServerUnhealthy's instanceof
  // exemption survives the getErrorMessage call.
  | { kind: 'error'; message: string; originalError: unknown }

/**
 * `discoveryStartedAt` is what makes a status write conditional: a discovery
 * that started before a newer attempt already landed must not overwrite it.
 * Both outcomes carry it, because a slow success can clobber a recent failure
 * exactly as a slow failure can clobber a recent success.
 */
type ServerStatusUpdate = { discoveryStartedAt?: Date } & (
  | { outcome: 'connected'; toolCount: number }
  | { outcome: 'failed'; error: string }
)

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
  // AbortSignal.timeout / undici surface a DOMException named TimeoutError whose
  // message ("The operation was aborted due to timeout") lacks "timed out".
  const e = error as { name?: string; cause?: { name?: string } } | null
  if (e?.name === 'TimeoutError' || e?.cause?.name === 'TimeoutError') {
    return true
  }
  return getErrorMessage(error, '').toLowerCase().includes('timed out')
}

/**
 * A pooled connection is dead and must be retired so the caller's retry rebuilds
 * fresh: a stale session (400/404), an auth failure (401 — a rotated/revoked
 * credential; the rebuild re-resolves it), a closed transport, or a reset socket.
 *
 * A request timeout is deliberately NOT dead: streamable-HTTP aborts only that
 * request's own POST stream, leaving the session healthy for the next request, so
 * every production MCP client (SDK, OpenCode, LibreChat) rejects the request and
 * keeps the connection rather than tearing it down. Retiring on a timeout instead
 * forced a full reconnect on the next discovery — and a fresh connect can stall on
 * our end far longer than a warm request — turning one slow response into a
 * connect/stall/reconnect churn loop. Benign tool/consent errors and healthy
 * upstream responses (429/5xx) also keep the connection warm.
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
  const message = getErrorMessage(error, '').toLowerCase()
  return (
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('epipe') ||
    message.includes('socket hang up')
  )
}

/**
 * An auth failure (401) from a rotated/revoked credential. Safe for `executeTool`
 * to retry — auth is rejected *before* the tool runs, so re-acquiring on a fresh
 * connection (which re-resolves the credential) can't double-execute a tool.
 */
function isAuthError(error: unknown): boolean {
  return (
    error instanceof UnauthorizedError ||
    (error instanceof StreamableHTTPError && error.code === 401)
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
    workspaceId?: string,
    onResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceCallback
  ): Promise<{
    config: McpServerConfig
    resolvedIP: string | null
    resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  }> {
    const { config: resolvedConfig, resolvedSecretTraceProvenance } = await resolveMcpConfigEnvVars(
      config,
      userId,
      workspaceId,
      {
        strict: true,
        onResolvedSecretTraceProvenance,
      }
    )
    validateMcpDomain(resolvedConfig.url)
    const resolvedIP = await validateMcpServerSsrf(resolvedConfig.url)
    return { config: resolvedConfig, resolvedIP, resolvedSecretTraceProvenance }
  }

  private async getServerConfig(
    serverId: string,
    scopeInput: string | ResourceScope
  ): Promise<McpServerConfig | null> {
    const scope: ResourceScope =
      typeof scopeInput === 'string' ? { kind: 'workspace', workspaceId: scopeInput } : scopeInput
    const [server] = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, serverId),
          resourceScopeCondition(mcpServers, scope),
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
      ...resourceScopeFields(scope),
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
        workspaceId,
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
    userId?: string,
    resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1,
    signal?: AbortSignal
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
        resolvedSecretTraceProvenance,
      })
      await client.connect({ signal })
      return client
    }

    if (!userId || !config.workspaceId) {
      throw new Error('OAuth MCP server requires both userId and workspaceId')
    }
    const workspaceId = config.workspaceId

    const loadProvider = async () => {
      const row = await getOrCreateOauthRow({
        mcpServerId: config.id,
        userId,
        workspaceId,
      })
      if (!row.tokens) {
        throw new McpOauthAuthorizationRequiredError(config.id, config.name)
      }
      const preregistered = await loadPreregisteredClient(config.id)
      return new SimMcpOauthProvider({ row, preregistered })
    }
    const client = new McpClient({
      config,
      securityPolicy,
      oauthCredentials: {
        credentialId: config.id,
        loadProvider,
        initialProvider: await loadProvider(),
      },
      resolvedIP: resolvedIP ?? undefined,
      resolvedSecretTraceProvenance,
    })
    await client.connect({ signal })
    return client
  }

  private async createManagedOauthClient(
    config: McpServerConfig,
    auth: OAuthClientProvider | McpOauthCredentials,
    signal?: AbortSignal
  ): Promise<McpClient> {
    if (config.authType !== 'oauth' || !config.url) {
      throw new Error('Managed MCP connection requires an OAuth HTTP server')
    }
    if (
      [config.url, ...Object.values(config.headers ?? {})].some((value) =>
        createEnvVarPattern().test(value)
      )
    ) {
      throw new Error('Credential Group MCP servers cannot use personal environment references')
    }
    validateMcpDomain(config.url)
    const resolvedIP = await validateMcpServerSsrf(config.url)
    const client = new McpClient({
      config,
      securityPolicy: {
        requireConsent: true,
        auditLevel: 'basic',
        maxToolExecutionsPerHour: 1000,
        allowedOrigins: [new URL(config.url).origin],
      },
      ...('loadProvider' in auth
        ? { oauthCredentials: { ...auth, initialProvider: await auth.loadProvider() } }
        : { authProvider: auth }),
      resolvedIP: resolvedIP ?? undefined,
    })
    await client.connect({ signal })
    return client
  }

  async discoverManagedMcpTools(
    serverId: string,
    scope: string | ResourceScope,
    auth: OAuthClientProvider | McpOauthCredentials,
    signal?: AbortSignal,
    options: { requireComplete?: boolean } = {}
  ): Promise<McpTool[]> {
    const config = await this.getServerConfig(serverId, scope)
    if (!config) throw new Error('Managed MCP server is unavailable')
    return this.withServerClient(
      { key: '', serverId, allowPool: false },
      () => this.createManagedOauthClient(config, auth, signal),
      (client) =>
        options.requireComplete
          ? client.listTools(signal, { requireComplete: true })
          : client.listTools(signal)
    )
  }

  async executeManagedMcpTool(params: {
    connectionId: string
    serverId: string
    scope: ResourceScope
    toolCall: McpToolCall
    loadAuthProvider: () => Promise<OAuthClientProvider>
    extraHeaders?: Record<string, string>
    signal?: AbortSignal
    timeoutMs?: number
  }): Promise<McpToolResult> {
    const config = await this.getServerConfig(params.serverId, params.scope)
    if (!config) throw new Error('Managed MCP server is unavailable')
    const effectiveConfig = params.extraHeaders
      ? { ...config, headers: { ...config.headers, ...params.extraHeaders } }
      : config
    return this.withServerClient(
      { key: '', serverId: params.serverId, allowPool: false },
      () =>
        this.createManagedOauthClient(
          effectiveConfig,
          { credentialId: params.connectionId, loadProvider: params.loadAuthProvider },
          params.signal
        ),
      (client) =>
        client.callTool(params.toolCall, {
          signal: params.signal,
          timeoutMs: params.timeoutMs,
        })
    )
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
   * A `create` thunk for {@link withServerClient} that resolves env vars + SSRF-pins
   * and connects. Deferred so a pool hit skips this work; `extraHeaders` (per-request)
   * are merged in and force the caller to bypass the pool.
   */
  private buildClient(
    config: McpServerConfig,
    userId: string,
    workspaceId: string,
    extraHeaders?: Record<string, string>,
    onResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceCallback,
    signal?: AbortSignal
  ): () => Promise<McpClient> {
    return async () => {
      const {
        config: resolvedConfig,
        resolvedIP,
        resolvedSecretTraceProvenance,
      } = await this.resolveConfigEnvVars(
        config,
        userId,
        workspaceId,
        onResolvedSecretTraceProvenance
      )
      if (extraHeaders) {
        resolvedConfig.headers = { ...resolvedConfig.headers, ...extraHeaders }
      }
      return this.createClient(
        resolvedConfig,
        resolvedIP,
        userId,
        resolvedSecretTraceProvenance,
        signal
      )
    }
  }

  /**
   * Pooled `tools/list` for one server, with a single retry on a non-OAuth auth
   * failure: a rotated header key throws 401, which retires the pooled connection,
   * so the retry re-acquires a fresh one that re-resolves the credential. (OAuth
   * 401s are left to the caller's oauth-pending handling.) `listTools` is
   * idempotent, so the retry is always safe.
   */
  private async fetchServerTools(
    config: McpServerConfig,
    userId: string,
    workspaceId: string,
    onResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceCallback,
    signal?: AbortSignal,
    requireComplete = false
  ): Promise<McpTool[]> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted()
      try {
        return await this.withServerClient(
          {
            key: this.poolKey(config.id, workspaceId, userId),
            serverId: config.id,
            allowPool: true,
          },
          this.buildClient(
            config,
            userId,
            workspaceId,
            undefined,
            onResolvedSecretTraceProvenance,
            signal
          ),
          (client) => {
            reportRetainedClientProvenance(
              client.getResolvedSecretTraceProvenance?.(),
              userId,
              workspaceId,
              onResolvedSecretTraceProvenance
            )
            return requireComplete
              ? client.listTools(signal, { requireComplete: true })
              : client.listTools(signal)
          }
        )
      } catch (error) {
        signal?.throwIfAborted()
        if (attempt === 0 && isAuthError(error) && config.authType !== 'oauth') continue
        throw error
      }
    }
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
      let sawTimeout = false
      try {
        return await fn(lease.client)
      } catch (error) {
        poison = isDeadConnectionError(error)
        // A lone timeout keeps the session; the pool's circuit breaker retires it
        // after consecutive timeouts with no healthy request in between.
        sawTimeout = isTimeoutError(error)
        throw error
      } finally {
        await lease.release(poison, sawTimeout)
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
    extraHeaders?: Record<string, string>,
    onResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceCallback,
    options: McpToolExecutionOptions = {}
  ): Promise<McpToolResult> {
    const requestId = generateRequestId()
    const maxRetries = 2
    const reportProvenance = createInvocationProvenanceReporter(onResolvedSecretTraceProvenance)

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      options.signal?.throwIfAborted()
      try {
        logger.info(
          `[${requestId}] Executing MCP tool ${toolCall.name} on server ${serverId} for user ${userId}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`
        )

        const config = await this.getServerConfig(serverId, workspaceId)
        if (!config) {
          throw new Error(`Server ${serverId} not found or not accessible`)
        }

        const hasExtraHeaders = Boolean(extraHeaders && Object.keys(extraHeaders).length > 0)
        const result = await this.withServerClient(
          {
            key: this.poolKey(serverId, workspaceId, userId),
            serverId,
            allowPool: !hasExtraHeaders,
          },
          this.buildClient(
            config,
            userId,
            workspaceId,
            hasExtraHeaders ? extraHeaders : undefined,
            reportProvenance,
            options.signal
          ),
          (client) => {
            reportRetainedClientProvenance(
              client.getResolvedSecretTraceProvenance?.(),
              userId,
              workspaceId,
              reportProvenance
            )
            return client.callTool(toolCall, options)
          }
        )
        logger.info(`[${requestId}] Successfully executed tool ${toolCall.name}`)
        return result
      } catch (error) {
        options.signal?.throwIfAborted()
        // A stale session (400/404) or a rotated/revoked credential (401) is rejected
        // before the tool runs, so retrying on a fresh connection is safe and recovers
        // the request. Timeouts/resets are NOT retried — the tool may have executed.
        if ((this.isSessionError(error) || isAuthError(error)) && attempt < maxRetries - 1) {
          logger.warn(
            `[${requestId}] Retryable connection error executing tool ${toolCall.name}, retrying (attempt ${attempt + 1}):`,
            error
          )
          await interruptibleSleep(100, options.signal)
          options.signal?.throwIfAborted()
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

  /**
   * Records the outcome of a discovery attempt on the server row.
   *
   * Deliberately leaves `updatedAt` alone. `updatedAt` means "when the server's
   * configuration last changed" and is one of the public list's keyset sorts, so
   * stamping it from a background discovery would move rows to the head of
   * `sortBy=updatedAt` mid-walk and duplicate or skip servers across a caller's
   * pages. Discovery liveness is already published through `lastConnected`,
   * `lastToolsRefresh`, `lastError` and `statusConfig`.
   */
  private async updateServerStatus(
    serverId: string,
    workspaceId: string,
    update: ServerStatusUpdate
  ): Promise<boolean> {
    try {
      const now = new Date()
      /**
       * Both outcomes carry the same guard: a discovery that started before a
       * newer attempt already landed must not overwrite it, and neither branch
       * may write onto a foreign or soft-deleted row. Without it on the success
       * branch a slow connect could revive a server a later failure had just
       * marked down, with a stale `toolCount` and a cleared `lastError`.
       */
      const liveServerScope = and(
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

      if (update.outcome === 'connected') {
        const updatedServers = await db
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
          })
          .where(liveServerScope)
          .returning({ id: mcpServers.id })
        return updatedServers.length > 0
      }

      /**
       * The failure counter is incremented SQL-side rather than read, added to,
       * and written back. Two concurrent failures both reading N and writing N+1
       * lose a count, so a flapping server could sit below
       * {@link MCP_CONSTANTS.MAX_CONSECUTIVE_FAILURES} indefinitely and never
       * flip to `error`. `lastSuccessfulDiscovery` is carried through from the
       * stored blob in the same statement.
       */
      const nextFailures = sql`COALESCE((${mcpServers.statusConfig} ->> 'consecutiveFailures')::int, 0) + 1`

      const updatedServers = await db
        .update(mcpServers)
        .set({
          connectionStatus: sql`CASE WHEN ${nextFailures} >= ${MCP_CONSTANTS.MAX_CONSECUTIVE_FAILURES} THEN 'error' ELSE 'disconnected' END`,
          lastError: truncate(update.error || 'Unknown error', MAX_MCP_LAST_ERROR_LENGTH),
          statusConfig: sql`jsonb_build_object('consecutiveFailures', ${nextFailures}, 'lastSuccessfulDiscovery', ${mcpServers.statusConfig} -> 'lastSuccessfulDiscovery')`,
        })
        .where(liveServerScope)
        .returning({ id: mcpServers.id, statusConfig: mcpServers.statusConfig })

      const failures = (updatedServers[0]?.statusConfig as Partial<McpServerStatusConfig> | null)
        ?.consecutiveFailures
      if (typeof failures === 'number' && failures >= MCP_CONSTANTS.MAX_CONSECUTIVE_FAILURES) {
        logger.warn(`Server ${serverId} marked as error after ${failures} consecutive failures`)
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

  /**
   * Discover tools across every server in a workspace. See
   * {@link McpDiscoveryRefresh} for what each mode is allowed to bypass — the
   * fan-out makes the cooldown matter more here, not less.
   */
  async discoverTools(
    userId: string,
    workspaceId: string,
    refresh: McpDiscoveryRefresh = 'cache-aside'
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

          if (refresh === 'cache-aside') {
            try {
              const cached = await this.cacheAdapter.get(cacheKey)
              if (cached) return { kind: 'cached', tools: cached.tools }
            } catch (error) {
              logger.warn(
                `[${requestId}] Cache read failed for ${config.name}, proceeding with discovery:`,
                error
              )
            }
          }

          if (refresh !== 'force' && (await this.isServerUnhealthy(workspaceId, config.id))) {
            logger.info(
              `[${requestId}] Skipping recently-failed server ${config.name} (negative-cache hit)`
            )
            return { kind: 'unhealthy' }
          }

          try {
            const tools = await this.fetchServerTools(config, userId, workspaceId)
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
              discoveryStartedAt,
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
          // Mark disconnected so the UI surfaces the re-auth button, and drop the positive
          // tool cache so a follow-up force-refresh can't serve tools for a server that now
          // needs re-auth (mirrors the single-server discovery path).
          logger.info(`[${requestId}] Skipping server ${server.name}: OAuth authorization pending`)
          deferredSideEffects.push(
            this.markServerOauthPending(server.id, workspaceId, discoveryStartedAt).then(
              async (statusApplied) => {
                if (!statusApplied) return
                await this.cacheAdapter
                  .delete(serverCacheKey(workspaceId, server.id))
                  .catch((err) =>
                    logger.warn(`[${requestId}] Cache delete failed for ${server.name}:`, err)
                  )
              }
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
          // Kick the notification manager for every fetched server; `connect` is
          // idempotent (skips a live/connecting one) and reconnects a lost one with
          // this current config — do not pre-gate on `hasConnection`, whose state
          // survives a transport loss and would block that fresh reconnect.
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
   * Discover tools from one server. Cache-aside by default; see
   * {@link McpDiscoveryRefresh} for what each mode is allowed to bypass.
   * Concurrent callers for the same `(workspaceId, serverId, userId, refresh)`
   * share one upstream request.
   */
  async discoverServerTools(
    userId: string,
    serverId: string,
    workspaceId: string,
    refresh: McpDiscoveryRefresh = 'cache-aside',
    onResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceCallback,
    options: McpRequestOptions = {}
  ): Promise<McpTool[]> {
    if (onResolvedSecretTraceProvenance || options.signal || options.requireComplete) {
      return this.discoverServerToolsImpl(
        userId,
        serverId,
        workspaceId,
        refresh,
        createInvocationProvenanceReporter(onResolvedSecretTraceProvenance),
        options.signal,
        options.requireComplete
      )
    }

    const inflightKey = `${workspaceId}:${serverId}:${userId}:${refresh}:partial-ok`
    const existing = this.inflightServerDiscovery.get(inflightKey)
    if (existing) return existing

    const promise = this.discoverServerToolsImpl(
      userId,
      serverId,
      workspaceId,
      refresh,
      undefined,
      undefined,
      false
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
    refresh: McpDiscoveryRefresh,
    onResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceCallback,
    signal?: AbortSignal,
    requireComplete = false
  ): Promise<McpTool[]> {
    signal?.throwIfAborted()
    const requestId = generateRequestId()
    const discoveryStartedAt = new Date()
    const maxRetries = 2

    if (refresh === 'cache-aside' && !requireComplete) {
      try {
        const cached = await this.cacheAdapter.get(serverCacheKey(workspaceId, serverId))
        if (cached) {
          logger.debug(`[${requestId}] Cache hit for server ${serverId}`)
          return cached.tools
        }
      } catch (error) {
        logger.warn(`[${requestId}] Cache read failed for server ${serverId}:`, error)
      }
    }

    if (refresh !== 'force' && (await this.isServerUnhealthy(workspaceId, serverId))) {
      logger.info(`[${requestId}] Skipping recently-failed server ${serverId} (negative-cache)`)
      throw new McpServerCooldownError(serverId)
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      signal?.throwIfAborted()
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

        const tools = await this.fetchServerTools(
          config,
          userId,
          workspaceId,
          onResolvedSecretTraceProvenance,
          signal,
          requireComplete
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
            discoveryStartedAt,
          }),
        ])
        return tools
      } catch (error) {
        signal?.throwIfAborted()
        if (isRetryableDiscoveryError(error) && attempt < maxRetries - 1) {
          logger.warn(
            `[${requestId}] Transient error discovering tools from server ${serverId}, retrying (attempt ${attempt + 1}):`,
            error
          )
          await interruptibleSleep(
            backoffWithJitter(attempt + 1, null, { baseMs: 250, maxMs: 2000 }),
            signal
          )
          signal?.throwIfAborted()
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
          const tools = await this.fetchServerTools(config, userId, workspaceId)

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

  /**
   * Invalidate the MCP tool cache. This does NOT evict pooled connections —
   * pool eviction is tied to config changes (see `evictServerConnections`), so a
   * refresh or a single-server edit doesn't tear down unrelated warm connections.
   */
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

  /** Evict a single server's warm pooled connections (all users) — call on config change/delete. */
  async evictServerConnections(serverId: string, reason: string): Promise<void> {
    await evictMcpServerConnections(serverId, reason)
  }
}

export const mcpService = new McpService()
