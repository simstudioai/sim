import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  LATEST_PROTOCOL_VERSION,
  type ListToolsResult,
  SUPPORTED_PROTOCOL_VERSIONS,
  type Tool,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { getMcpSafeErrorDiagnostics } from '@/lib/mcp/error-diagnostics'
import { withMcpHttpDiagnostics } from '@/lib/mcp/http-diagnostics'
import { McpOauthRedirectRequired } from '@/lib/mcp/oauth'
import { createPinnedMcpFetch } from '@/lib/mcp/pinned-fetch'
import {
  type McpClientOptions,
  McpConnectionError,
  type McpConnectionStatus,
  type McpConsentRequest,
  type McpConsentResponse,
  McpError,
  type McpSecurityPolicy,
  type McpServerConfig,
  type McpTool,
  type McpToolCall,
  type McpToolResult,
  type McpToolsChangedCallback,
  type McpVersionInfo,
} from '@/lib/mcp/types'
import { MCP_CLIENT_CONSTANTS } from '@/lib/mcp/utils'
import { createEnvVarPattern } from '@/executor/utils/reference-validation'

const logger = createLogger('McpClient')

type ConnectionOutcome =
  | 'started'
  | 'connected'
  | 'authorization_required'
  | 'timeout'
  | 'unauthorized'
  | 'cancelled'
  | 'error'

function classifyConnectionOutcome(
  error: unknown,
  authType: McpServerConfig['authType']
): ConnectionOutcome {
  if (error instanceof McpOauthRedirectRequired) {
    return 'authorization_required'
  }
  if (error instanceof UnauthorizedError) {
    return authType === 'oauth' ? 'authorization_required' : 'unauthorized'
  }
  const message = getErrorMessage(error, '').toLowerCase()
  if (message.includes('connection attempt cancelled')) return 'cancelled'
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout'
  if (message.includes('401') || message.includes('unauthorized')) return 'unauthorized'
  return 'error'
}

interface McpClientConnectOptions {
  isCancelled?: () => boolean
}

export class McpClient {
  private client: Client
  private transport: StreamableHTTPClientTransport
  private config: McpServerConfig
  private connectionStatus: McpConnectionStatus
  private securityPolicy: McpSecurityPolicy
  private onToolsChanged?: McpToolsChangedCallback
  private authProvider?: McpClientOptions['authProvider']
  private isConnected = false
  private closePinnedTransport?: () => Promise<void>

  constructor(options: McpClientOptions) {
    this.config = options.config
    this.securityPolicy = options.securityPolicy ?? {
      requireConsent: true,
      auditLevel: 'basic',
      maxToolExecutionsPerHour: 1000,
    }
    this.onToolsChanged = options.onToolsChanged
    this.authProvider = options.authProvider
    const resolvedIP = options.resolvedIP

    this.connectionStatus = { connected: false }

    if (!this.config.url) {
      throw new McpError('URL required for Streamable HTTP transport')
    }

    if (this.config.authType === 'oauth' && this.authProvider == null) {
      throw new McpError('OAuth MCP server requires an authProvider')
    }
    const useOauth = this.config.authType === 'oauth'
    const pinned = resolvedIP ? createPinnedMcpFetch(resolvedIP) : undefined
    this.closePinnedTransport = pinned?.close
    this.transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
      authProvider: useOauth ? this.authProvider : undefined,
      requestInit: { headers: this.config.headers },
      // Wrap whether pinned or not (SDK's default is globalThis.fetch, so passing it is
      // behavior-neutral) so the diagnostic also covers unpinned/allowlisted servers.
      fetch: withMcpHttpDiagnostics(pinned?.fetch ?? globalThis.fetch, 'transport'),
    })

    this.client = new Client(
      {
        name: 'sim-platform',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    )

    this.client.onerror = (error) => {
      logger.warn(`MCP transport error for ${this.config.name}`, {
        serverId: this.config.id,
        phase: 'transport',
        sessionIdPresent: Boolean(this.transport.sessionId),
        error: getMcpSafeErrorDiagnostics(error),
      })
    }
  }

  /**
   * Initialize connection to MCP server.
   * If an `onToolsChanged` callback was provided, registers a notification handler
   * for `notifications/tools/list_changed` after connecting.
   */
  async connect(options: McpClientConnectOptions = {}): Promise<void> {
    const startedAt = Date.now()
    const configuredTimeout = this.config.timeout
    const timeoutMs =
      configuredTimeout !== undefined && Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? Math.min(Math.floor(configuredTimeout), getMaxExecutionTimeout())
        : MCP_CLIENT_CONSTANTS.CLIENT_TIMEOUT
    const headerNames = Object.keys(this.config.headers ?? {}).sort()
    const hasUnresolvedEnvRefs = [
      this.config.url ?? '',
      ...Object.values(this.config.headers ?? {}),
    ].some((value) => createEnvVarPattern().test(value))
    const diagnostics = {
      serverId: this.config.id,
      authType: this.config.authType ?? (headerNames.length > 0 ? 'headers' : 'none'),
      headerNames,
      hasUnresolvedEnvRefs,
      phase: 'initialize',
      timeoutMs,
    }
    logger.info(`Connecting to MCP server: ${this.config.name} (${this.config.transport})`, {
      ...diagnostics,
      outcome: 'started' satisfies ConnectionOutcome,
    })

    try {
      await this.client.connect(this.transport, {
        timeout: timeoutMs,
      })
      if (options.isCancelled?.()) {
        await this.client.close().catch((error) => {
          logger.warn(`Error closing cancelled connection to ${this.config.name}:`, error)
        })
        // The Agent is released by the shared catch below, which this throw enters.
        throw new McpConnectionError('Connection attempt cancelled', this.config.name)
      }

      this.isConnected = true
      this.connectionStatus.connected = true
      this.connectionStatus.lastConnected = new Date()

      if (this.onToolsChanged) {
        this.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
          if (!this.isConnected) return
          logger.info(`[${this.config.name}] Received tools/list_changed notification`)
          this.onToolsChanged?.(this.config.id)
        })
        logger.info(`[${this.config.name}] Registered tools/list_changed notification handler`)
      }

      const serverVersion = this.client.getServerVersion()
      logger.info(`Successfully connected to MCP server: ${this.config.name}`, {
        ...diagnostics,
        durationMs: Date.now() - startedAt,
        outcome: 'connected' satisfies ConnectionOutcome,
        protocolVersion: serverVersion,
      })
    } catch (error) {
      this.isConnected = false
      // A failed connect discards this client without a disconnect(), so release the Agent here.
      await this.closeTransportAgent()
      const errorMessage = getErrorMessage(error, 'Unknown error')
      const outcome = classifyConnectionOutcome(error, this.config.authType)
      logger.error(`Failed to connect to MCP server ${this.config.name}`, {
        ...diagnostics,
        durationMs: Date.now() - startedAt,
        error: getMcpSafeErrorDiagnostics(error),
        outcome,
      })
      if (outcome === 'authorization_required') {
        this.connectionStatus.lastError = undefined
        throw error
      }
      if (error instanceof UnauthorizedError) {
        this.connectionStatus.lastError = 'Authentication failed'
        throw error
      }
      this.connectionStatus.lastError = errorMessage
      throw new McpConnectionError(errorMessage, this.config.name)
    }
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting from MCP server: ${this.config.name}`)

    try {
      await this.client.close()
    } catch (error) {
      logger.warn(`Error during disconnect from ${this.config.name}:`, error)
    }

    await this.closeTransportAgent()

    this.isConnected = false
    this.connectionStatus.connected = false
    logger.info(`Disconnected from MCP server: ${this.config.name}`)
  }

  /**
   * Tears down the pinned transport's HTTP/2 Agent, releasing its sockets. Must run
   * on every terminal path — successful disconnect, and failed or cancelled connect —
   * since a failed `connect()` discards this client without a `disconnect()` call.
   * Idempotent: the handle is cleared before use so repeat calls (a failed connect
   * followed by the caller's `disconnect()`) never destroy the same Agent twice.
   */
  private async closeTransportAgent(): Promise<void> {
    const close = this.closePinnedTransport
    if (!close) return
    this.closePinnedTransport = undefined
    try {
      await close()
    } catch (error) {
      logger.warn(`Error closing pinned transport for ${this.config.name}:`, error)
    }
  }

  getStatus(): McpConnectionStatus {
    return { ...this.connectionStatus }
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.isConnected) {
      throw new McpConnectionError('Not connected to server', this.config.name)
    }

    const configuredTimeout = this.config.timeout
    const idleTimeoutMs = Math.min(
      configuredTimeout !== undefined && Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? Math.floor(configuredTimeout)
        : MCP_CLIENT_CONSTANTS.LIST_TOOLS_TIMEOUT_MS,
      getMaxExecutionTimeout(),
      MCP_CLIENT_CONSTANTS.LIST_TOOLS_MAX_TOTAL_TIMEOUT_MS
    )
    const maxTotalTimeoutMs = MCP_CLIENT_CONSTANTS.LIST_TOOLS_MAX_TOTAL_TIMEOUT_MS
    const startedAt = Date.now()

    try {
      const result: ListToolsResult = await this.client.listTools(undefined, {
        // resetTimeoutOnProgress only takes effect when onprogress is supplied.
        timeout: idleTimeoutMs,
        maxTotalTimeout: maxTotalTimeoutMs,
        resetTimeoutOnProgress: true,
        onprogress: (progress) => {
          logger.debug(`Tool discovery progress from ${this.config.name}`, {
            serverId: this.config.id,
            progress: progress.progress,
            total: progress.total,
          })
        },
      })

      if (!result.tools || !Array.isArray(result.tools)) {
        logger.warn(`Invalid tools response from server ${this.config.name}:`, result)
        return []
      }

      return result.tools.map((tool: Tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as McpTool['inputSchema'],
        serverId: this.config.id,
        serverName: this.config.name,
      }))
    } catch (error) {
      logger.error(`Failed to list tools from server ${this.config.name}`, {
        serverId: this.config.id,
        phase: 'tools/list',
        durationMs: Date.now() - startedAt,
        idleTimeoutMs,
        maxTotalTimeoutMs,
        sessionIdPresent: Boolean(this.transport.sessionId),
        error: getMcpSafeErrorDiagnostics(error),
      })
      throw error
    }
  }

  async callTool(toolCall: McpToolCall): Promise<McpToolResult> {
    if (!this.isConnected) {
      throw new McpConnectionError('Not connected to server', this.config.name)
    }

    const consentRequest: McpConsentRequest = {
      type: 'tool_execution',
      context: {
        serverId: this.config.id,
        serverName: this.config.name,
        action: toolCall.name,
        description: `Execute tool '${toolCall.name}' on ${this.config.name}`,
        dataAccess: Object.keys(toolCall.arguments || {}),
        sideEffects: ['tool_execution'],
      },
      expires: Date.now() + 5 * 60 * 1000,
    }

    const consentResponse = await this.requestConsent(consentRequest)
    if (!consentResponse.granted) {
      throw new McpError(`User consent denied for tool execution: ${toolCall.name}`, -32000, {
        consentAuditId: consentResponse.auditId,
      })
    }

    try {
      logger.info(`Calling tool ${toolCall.name} on server ${this.config.name}`, {
        consentAuditId: consentResponse.auditId,
        protocolVersion: this.getNegotiatedVersion(),
      })

      const sdkResult = await this.client.callTool(
        { name: toolCall.name, arguments: toolCall.arguments },
        undefined,
        { timeout: getMaxExecutionTimeout() }
      )

      return sdkResult as McpToolResult
    } catch (error) {
      logger.error(`Failed to call tool ${toolCall.name} on server ${this.config.name}:`, error)
      throw error
    }
  }

  async ping(timeoutMs?: number): Promise<{ _meta?: Record<string, any> }> {
    if (!this.isConnected) {
      throw new McpConnectionError('Not connected to server', this.config.name)
    }

    try {
      logger.info(`[${this.config.name}] Sending ping to server`)
      // Bound the ping so a half-open connection (no FIN/RST, so `onclose` never
      // fires) is detected quickly instead of stalling on the SDK's 60s default.
      const response = await this.client.ping(
        timeoutMs !== undefined ? { timeout: timeoutMs } : undefined
      )
      logger.info(`[${this.config.name}] Ping successful`)
      return response
    } catch (error) {
      logger.error(`[${this.config.name}] Ping failed:`, error)
      throw error
    }
  }

  hasListChangedCapability(): boolean {
    return !!this.client.getServerCapabilities()?.tools?.listChanged
  }

  /** Chains with the SDK's internal onclose handler so its cleanup still runs. */
  onClose(callback: () => void): void {
    const existingHandler = this.transport.onclose
    this.transport.onclose = () => {
      existingHandler?.()
      callback()
    }
  }

  getConfig(): McpServerConfig {
    return { ...this.config }
  }

  static getVersionInfo(): McpVersionInfo {
    return {
      supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      preferred: LATEST_PROTOCOL_VERSION,
    }
  }

  getNegotiatedVersion(): string | undefined {
    const serverVersion = this.client.getServerVersion()
    return typeof serverVersion === 'string' ? serverVersion : undefined
  }

  getSessionId(): string | undefined {
    return this.transport.sessionId
  }

  async requestConsent(consentRequest: McpConsentRequest): Promise<McpConsentResponse> {
    if (!this.securityPolicy.requireConsent) {
      return { granted: true, auditId: `audit-${Date.now()}` }
    }

    const { serverId, serverName, action, sideEffects } = consentRequest.context

    if (this.securityPolicy.blockedOrigins?.includes(this.config.url || '')) {
      logger.warn(`Tool execution blocked: Server ${serverName} is in blocked origins`)
      return {
        granted: false,
        auditId: `audit-blocked-${Date.now()}`,
      }
    }

    if (this.securityPolicy.auditLevel === 'detailed') {
      logger.info(`Consent requested for ${action} on ${serverName}`, {
        serverId,
        action,
        sideEffects,
        timestamp: new Date().toISOString(),
      })
    }

    return {
      granted: true,
      expires: consentRequest.expires,
      auditId: `audit-${serverId}-${Date.now()}`,
    }
  }
}
