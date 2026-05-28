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
import { McpOauthRedirectRequired } from '@/lib/mcp/oauth'
import { createMcpPinnedFetch } from '@/lib/mcp/pinned-fetch'
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

const logger = createLogger('McpClient')

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
    this.transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
      authProvider: useOauth ? this.authProvider : undefined,
      requestInit: { headers: this.config.headers },
      ...(resolvedIP ? { fetch: createMcpPinnedFetch(resolvedIP) } : {}),
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
  }

  /**
   * Initialize connection to MCP server.
   * If an `onToolsChanged` callback was provided, registers a notification handler
   * for `notifications/tools/list_changed` after connecting.
   */
  async connect(options: McpClientConnectOptions = {}): Promise<void> {
    logger.info(`Connecting to MCP server: ${this.config.name} (${this.config.transport})`)

    try {
      await this.client.connect(this.transport)
      if (options.isCancelled?.()) {
        await this.client.close().catch((error) => {
          logger.warn(`Error closing cancelled connection to ${this.config.name}:`, error)
        })
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
        protocolVersion: serverVersion,
      })
    } catch (error) {
      this.isConnected = false
      if (error instanceof McpOauthRedirectRequired || error instanceof UnauthorizedError) {
        this.connectionStatus.lastError = undefined
        throw error
      }
      const errorMessage = getErrorMessage(error, 'Unknown error')
      this.connectionStatus.lastError = errorMessage
      logger.error(`Failed to connect to MCP server ${this.config.name}:`, error)
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

    this.isConnected = false
    this.connectionStatus.connected = false
    logger.info(`Disconnected from MCP server: ${this.config.name}`)
  }

  getStatus(): McpConnectionStatus {
    return { ...this.connectionStatus }
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.isConnected) {
      throw new McpConnectionError('Not connected to server', this.config.name)
    }

    try {
      const result: ListToolsResult = await this.client.listTools(undefined, {
        timeout: MCP_CLIENT_CONSTANTS.LIST_TOOLS_TIMEOUT_MS,
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
      logger.error(`Failed to list tools from server ${this.config.name}:`, error)
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

  async ping(): Promise<{ _meta?: Record<string, any> }> {
    if (!this.isConnected) {
      throw new McpConnectionError('Not connected to server', this.config.name)
    }

    try {
      logger.info(`[${this.config.name}] Sending ping to server`)
      const response = await this.client.ping()
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
