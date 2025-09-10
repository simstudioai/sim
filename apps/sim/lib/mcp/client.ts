/**
 * MCP (Model Context Protocol) JSON-RPC 2.0 Client
 *
 * Implements the client side of MCP protocol with support for:
 * - Streamable HTTP transport (MCP 2025-03-26)
 * - Connection lifecycle management
 * - Tool execution and discovery
 * - Session management with Mcp-Session-Id header
 */

import { createLogger } from '@/lib/logs/console/logger'
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpCapabilities,
  McpConnectionError,
  type McpConnectionStatus,
  type McpConsentRequest,
  type McpConsentResponse,
  McpError,
  type McpInitializeParams,
  type McpInitializeResult,
  type McpSecurityPolicy,
  type McpServerConfig,
  McpTimeoutError,
  type McpTool,
  type McpToolCall,
  type McpToolResult,
  type McpVersionInfo,
} from '@/lib/mcp/types'

const logger = createLogger('McpClient')

export class McpClient {
  private config: McpServerConfig
  private connectionStatus: McpConnectionStatus
  private requestId = 0
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: JsonRpcResponse) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >()
  private serverCapabilities?: McpCapabilities
  private mcpSessionId?: string
  private negotiatedVersion?: string
  private securityPolicy: McpSecurityPolicy

  // Supported protocol versions
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
  }

  /**
   * Initialize connection to MCP server
   */
  async connect(): Promise<void> {
    logger.info(`Connecting to MCP server: ${this.config.name} (${this.config.transport})`)

    try {
      switch (this.config.transport) {
        case 'http':
          await this.connectStreamableHttp()
          break
        case 'sse':
          await this.connectStreamableHttp()
          break
        case 'streamable-http':
          await this.connectStreamableHttp()
          break
        default:
          throw new McpError(`Unsupported transport: ${this.config.transport}`)
      }

      await this.initialize()
      this.connectionStatus.connected = true
      this.connectionStatus.lastConnected = new Date()

      logger.info(`Successfully connected to MCP server: ${this.config.name}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.connectionStatus.lastError = errorMessage
      logger.error(`Failed to connect to MCP server ${this.config.name}:`, error)
      throw new McpConnectionError(errorMessage, this.config.id)
    }
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect(): Promise<void> {
    logger.info(`Disconnecting from MCP server: ${this.config.name}`)

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new McpError('Connection closed'))
    }
    this.pendingRequests.clear()

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
    if (!this.connectionStatus.connected) {
      throw new McpConnectionError('Not connected to server', this.config.id)
    }

    try {
      const response = await this.sendRequest('tools/list', {})

      if (!response.tools || !Array.isArray(response.tools)) {
        logger.warn(`Invalid tools response from server ${this.config.name}:`, response)
        return []
      }

      return response.tools.map((tool: any) => ({
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
    if (!this.connectionStatus.connected) {
      throw new McpConnectionError('Not connected to server', this.config.id)
    }

    // Request consent for tool execution
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
      expires: Date.now() + 5 * 60 * 1000, // 5 minute consent window
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
        protocolVersion: this.negotiatedVersion,
      })

      const response = await this.sendRequest('tools/call', {
        name: toolCall.name,
        arguments: toolCall.arguments,
      })

      // The response is the JSON-RPC 'result' field
      return response as McpToolResult
    } catch (error) {
      logger.error(`Failed to call tool ${toolCall.name} on server ${this.config.name}:`, error)
      throw error
    }
  }

  /**
   * Send a JSON-RPC request to the server
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    const id = ++this.requestId
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new McpTimeoutError(this.config.id, this.config.timeout || 30000))
      }, this.config.timeout || 30000)

      this.pendingRequests.set(id, { resolve, reject, timeout })

      this.sendHttpRequest(request).catch(reject)
    })
  }

  /**
   * Initialize connection with capability and version negotiation
   */
  private async initialize(): Promise<void> {
    // Start with latest supported version for negotiation
    const preferredVersion = McpClient.SUPPORTED_VERSIONS[0]

    const initParams: McpInitializeParams = {
      protocolVersion: preferredVersion,
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
        logging: { level: 'info' },
      },
      clientInfo: {
        name: 'sim-platform',
        version: '1.0.0',
      },
    }

    try {
      const result: McpInitializeResult = await this.sendRequest('initialize', initParams)

      // Handle version negotiation
      if (result.protocolVersion !== preferredVersion) {
        // Server proposed a different version - check if we support it
        if (!McpClient.SUPPORTED_VERSIONS.includes(result.protocolVersion)) {
          // Client SHOULD disconnect if it cannot support proposed version
          throw new McpError(
            `Version negotiation failed: Server proposed unsupported version '${result.protocolVersion}'. ` +
              `This client supports versions: ${McpClient.SUPPORTED_VERSIONS.join(', ')}. ` +
              `To use this server, you may need to update your client or find a compatible version of the server.`
          )
        }

        logger.info(
          `Version negotiation: Server proposed version '${result.protocolVersion}' ` +
            `instead of requested '${preferredVersion}'. Using server version.`
        )
      }

      this.negotiatedVersion = result.protocolVersion
      this.serverCapabilities = result.capabilities

      logger.info(`MCP initialization successful with protocol version '${this.negotiatedVersion}'`)
    } catch (error) {
      // Enhanced error handling
      if (error instanceof McpError) {
        throw error // Re-throw MCP errors as-is
      }

      // Handle network errors
      if (error instanceof Error) {
        if (error.message.includes('fetch') || error.message.includes('network')) {
          throw new McpError(
            `Failed to connect to MCP server '${this.config.name}': ${error.message}. ` +
              `Please check the server URL and ensure the server is running.`
          )
        }

        if (error.message.includes('timeout')) {
          throw new McpError(
            `Connection timeout to MCP server '${this.config.name}'. ` +
              `The server may be slow to respond or unreachable.`
          )
        }

        // Generic error
        throw new McpError(
          `Connection to MCP server '${this.config.name}' failed: ${error.message}. ` +
            `Please verify the server configuration and try again.`
        )
      }

      throw new McpError(`Unexpected error during MCP initialization: ${String(error)}`)
    }

    await this.sendNotification('notifications/initialized', {})
  }

  /**
   * Send a notification
   */
  private async sendNotification(method: string, params: any): Promise<void> {
    const notification = {
      jsonrpc: '2.0' as const,
      method,
      params,
    }

    await this.sendHttpRequest(notification)
  }

  /**
   * Connect using Streamable HTTP transport
   */
  private async connectStreamableHttp(): Promise<void> {
    if (!this.config.url) {
      throw new McpError('URL required for Streamable HTTP transport')
    }

    logger.info(`Using Streamable HTTP transport for ${this.config.name}`)
  }

  /**
   * Send HTTP request with automatic retry
   */
  private async sendHttpRequest(request: JsonRpcRequest | any): Promise<void> {
    if (!this.config.url) {
      throw new McpError('URL required for HTTP transport')
    }

    const urlsToTry = [this.config.url]
    if (!this.config.url.endsWith('/')) {
      urlsToTry.push(`${this.config.url}/`)
    } else {
      urlsToTry.push(this.config.url.slice(0, -1))
    }

    let lastError: Error | null = null
    const originalUrl = this.config.url

    for (const [index, url] of urlsToTry.entries()) {
      try {
        await this.attemptHttpRequest(request, url, index === 0)

        if (index > 0) {
          logger.info(
            `[${this.config.name}] Successfully used alternative URL format: ${url} (original: ${originalUrl})`
          )
        }
        return
      } catch (error) {
        lastError = error as Error

        if (error instanceof McpError && !error.message.includes('404')) {
          break
        }

        if (index < urlsToTry.length - 1) {
          logger.info(
            `[${this.config.name}] Retrying with different URL format: ${urlsToTry[index + 1]}`
          )
        }
      }
    }

    throw lastError || new McpError('All URL variations failed')
  }

  /**
   * Attempt HTTP request
   */
  private async attemptHttpRequest(
    request: JsonRpcRequest | any,
    url: string,
    isOriginalUrl = true
  ): Promise<void> {
    if (!isOriginalUrl) {
      logger.info(`[${this.config.name}] Trying alternative URL format: ${url}`)
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.config.headers,
    }

    if (this.mcpSessionId) {
      headers['Mcp-Session-Id'] = this.mcpSessionId
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const responseText = await response.text().catch(() => 'Could not read response body')
      logger.error(`[${this.config.name}] HTTP request failed:`, {
        status: response.status,
        statusText: response.statusText,
        url,
        responseBody: responseText.substring(0, 500),
      })
      throw new McpError(`HTTP request failed: ${response.status} ${response.statusText}`)
    }

    if ('id' in request) {
      const contentType = response.headers.get('Content-Type')

      if (contentType?.includes('application/json')) {
        const sessionId = response.headers.get('Mcp-Session-Id')
        if (sessionId && !this.mcpSessionId) {
          this.mcpSessionId = sessionId
          logger.info(`[${this.config.name}] Received MCP Session ID: ${sessionId}`)
        }

        const responseData: JsonRpcResponse = await response.json()
        this.handleResponse(responseData)
      } else if (contentType?.includes('text/event-stream')) {
        const responseText = await response.text()
        this.handleSseResponse(responseText, request.id)
      } else {
        const unexpectedType = contentType || 'unknown'
        logger.warn(`[${this.config.name}] Unexpected response content type: ${unexpectedType}`)

        const responseText = await response.text()
        logger.debug(
          `[${this.config.name}] Unexpected response body:`,
          responseText.substring(0, 200)
        )

        throw new McpError(
          `Unexpected response content type: ${unexpectedType}. Expected application/json or text/event-stream.`
        )
      }
    }
  }

  /**
   * Handle JSON-RPC response
   */
  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      logger.warn(`Received response for unknown request ID: ${response.id}`)
      return
    }

    this.pendingRequests.delete(response.id)
    clearTimeout(pending.timeout)

    if (response.error) {
      const error = new McpError(response.error.message, response.error.code, response.error.data)
      pending.reject(error)
    } else {
      pending.resolve(response.result)
    }
  }

  /**
   * Handle Server-Sent Events response format
   */
  private handleSseResponse(responseText: string, requestId: string | number): void {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) {
      logger.warn(`Received SSE response for unknown request ID: ${requestId}`)
      return
    }

    try {
      // Parse SSE format - look for data: lines
      const lines = responseText.split('\n')
      let jsonData = ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.substring(6).trim()
          if (data && data !== '[DONE]') {
            jsonData += data
          }
        }
      }

      if (!jsonData) {
        logger.error(
          `[${this.config.name}] No valid data found in SSE response for request ${requestId}`
        )
        pending.reject(new McpError('No data in SSE response'))
        return
      }

      // Parse the JSON data
      const responseData: JsonRpcResponse = JSON.parse(jsonData)

      this.pendingRequests.delete(requestId)
      clearTimeout(pending.timeout)

      if (responseData.error) {
        const error = new McpError(
          responseData.error.message,
          responseData.error.code,
          responseData.error.data
        )
        pending.reject(error)
      } else {
        pending.resolve(responseData.result)
      }
    } catch (error) {
      logger.error(`[${this.config.name}] Failed to parse SSE response for request ${requestId}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        responseText: responseText.substring(0, 500),
      })

      this.pendingRequests.delete(requestId)
      clearTimeout(pending.timeout)
      pending.reject(new McpError('Failed to parse SSE response'))
    }
  }

  /**
   * Check if server has capability
   */
  hasCapability(capability: keyof McpCapabilities): boolean {
    return !!this.serverCapabilities?.[capability]
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
    return this.negotiatedVersion
  }

  /**
   * Request user consent for tool execution
   */
  async requestConsent(consentRequest: McpConsentRequest): Promise<McpConsentResponse> {
    if (!this.securityPolicy.requireConsent) {
      return { granted: true, auditId: `audit-${Date.now()}` }
    }

    // Basic security checks
    const { serverId, serverName, action, sideEffects } = consentRequest.context

    // Check if server is in blocked
    if (this.securityPolicy.blockedOrigins?.includes(this.config.url || '')) {
      logger.warn(`Tool execution blocked: Server ${serverName} is in blocked origins`)
      return {
        granted: false,
        auditId: `audit-blocked-${Date.now()}`,
      }
    }

    // For high-risk operations, log detailed audit
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
