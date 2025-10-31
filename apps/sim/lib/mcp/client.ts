/**
 * MCP (Model Context Protocol) Client
 *
 * Implements the client side of MCP protocol with support for:
 * - Streamable HTTP transport (MCP 2025-06-18)
 * - Tool execution and discovery
 * - Session management and protocol version negotiation
 * - Custom security/consent layer
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ListToolsResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@/lib/logs/console/logger'
import {
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
  type McpVersionInfo,
} from '@/lib/mcp/types'

const logger = createLogger('McpClient')

export class McpClient {
  private client: Client
  private transport: StreamableHTTPClientTransport
  private config: McpServerConfig
  private connectionStatus: McpConnectionStatus
  private securityPolicy: McpSecurityPolicy
  private isConnected = false

  private static readonly SUPPORTED_VERSIONS = [
    '2025-06-18', // Latest stable with elicitation and OAuth 2.1
    '2025-03-26', // Streamable HTTP support
    '2024-11-05', // Initial stable release
  ]

  constructor(config: McpServerConfig, securityPolicy?: McpSecurityPolicy) {
    this.config = config
    this.connectionStatus = { connected: false }
    this.securityPolicy = securityPolicy ?? {
      requireConsent: true,
      auditLevel: 'basic',
      maxToolExecutionsPerHour: 1000,
    }

    if (!this.config.url) {
      throw new McpError('URL required for Streamable HTTP transport')
    }

    this.transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
      requestInit: {
        headers: this.config.headers,
      },
    })

    this.client = new Client(
      {
        name: 'sim-platform',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          // Resources and prompts can be added later
          // resources: {},
          // prompts: {},
        },
      }
    )
  }

  /**
   * Initialize connection to MCP server
   */
  async connect(): Promise<void> {
    logger.info(`Connecting to MCP server: ${this.config.name} (${this.config.transport})`)

    try {
      await this.client.connect(this.transport)

      this.isConnected = true
      this.connectionStatus.connected = true
      this.connectionStatus.lastConnected = new Date()

      const serverVersion = this.client.getServerVersion()
      logger.info(`Successfully connected to MCP server: ${this.config.name}`, {
        protocolVersion: serverVersion,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.connectionStatus.lastError = errorMessage
      this.isConnected = false
      logger.error(`Failed to connect to MCP server ${this.config.name}:`, error)
      throw new McpConnectionError(errorMessage, this.config.id)
    }
  }

  /**
   * Disconnect from MCP server
   */
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

  /**
   * Get current connection status
   */
  getStatus(): McpConnectionStatus {
    return { ...this.connectionStatus }
  }

  /**
   * List all available tools from the server
   */
  async listTools(): Promise<McpTool[]> {
    if (!this.isConnected) {
      throw new McpConnectionError('Not connected to server', this.config.id)
    }

    try {
      const result: ListToolsResult = await this.client.listTools()

      if (!result.tools || !Array.isArray(result.tools)) {
        logger.warn(`Invalid tools response from server ${this.config.name}:`, result)
        return []
      }

      return result.tools.map((tool: Tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        serverId: this.config.id,
        serverName: this.config.name,
      }))
    } catch (error) {
      logger.error(`Failed to list tools from server ${this.config.name}:`, error)
      throw error
    }
  }

  /**
   * Execute a tool on the MCP server
   */
  async callTool(toolCall: McpToolCall): Promise<McpToolResult> {
    if (!this.isConnected) {
      throw new McpConnectionError('Not connected to server', this.config.id)
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

      const sdkResult = await this.client.callTool({
        name: toolCall.name,
        arguments: toolCall.arguments,
      })

      return sdkResult as McpToolResult
    } catch (error) {
      logger.error(`Failed to call tool ${toolCall.name} on server ${this.config.name}:`, error)
      throw error
    }
  }

  /**
   * Ping the server to check if it's still alive and responsive
   * Per MCP spec: servers should respond to ping requests
   */
  async ping(): Promise<{ _meta?: Record<string, any> }> {
    if (!this.isConnected) {
      throw new McpConnectionError('Not connected to server', this.config.id)
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

  /**
   * Check if server has capability
   */
  hasCapability(capability: string): boolean {
    const serverCapabilities = this.client.getServerCapabilities()
    return !!serverCapabilities?.[capability]
  }

  /**
   * Get server configuration
   */
  getConfig(): McpServerConfig {
    return { ...this.config }
  }

  /**
   * Get version information for this client
   */
  static getVersionInfo(): McpVersionInfo {
    return {
      supported: [...McpClient.SUPPORTED_VERSIONS],
      preferred: McpClient.SUPPORTED_VERSIONS[0],
    }
  }

  /**
   * Get the negotiated protocol version for this connection
   */
  getNegotiatedVersion(): string | undefined {
    const serverVersion = this.client.getServerVersion()
    return typeof serverVersion === 'string' ? serverVersion : undefined
  }

  /**
   * Request user consent for tool execution
   */
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
