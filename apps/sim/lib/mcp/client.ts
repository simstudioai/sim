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
  McpError,
  type McpInitializeParams,
  type McpInitializeResult,
  type McpServerConfig,
  McpTimeoutError,
  type McpTool,
  type McpToolCall,
  type McpToolResult,
} from '@/lib/mcp/types'

const logger = createLogger('McpClient')

export class McpClient {
  private config: McpServerConfig
  private connectionStatus: McpConnectionStatus
  private requestId = 0
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: any) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >()
  private serverCapabilities?: McpCapabilities
  private mcpSessionId?: string // MCP Session ID from server

  constructor(config: McpServerConfig) {
    this.config = config
    this.connectionStatus = { connected: false }
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

    try {
      logger.info(`Calling tool ${toolCall.name} on server ${this.config.name}`)
      logger.info(`Tool call arguments:`, {
        toolName: toolCall.name,
        arguments: toolCall.arguments,
        argumentsType: typeof toolCall.arguments,
        argumentsKeys: toolCall.arguments ? Object.keys(toolCall.arguments) : 'null',
      })

      const response = await this.sendRequest('tools/call', {
        name: toolCall.name,
        arguments: toolCall.arguments,
      })

      // The response is the JSON-RPC 'result' field, which can be:
      // 1. Standard MCP format: { content: [...], isError?: boolean }
      // 2. Rich format with additional fields like requestId, results, etc.
      // We preserve the full response to allow rich data to flow through
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
   * Initialize connection with capability negotiation
   */
  private async initialize(): Promise<void> {
    const initParams: McpInitializeParams = {
      protocolVersion: '2025-03-26',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      clientInfo: {
        name: 'sim-platform',
        version: '1.0.0',
      },
    }

    const result: McpInitializeResult = await this.sendRequest('initialize', initParams)

    this.serverCapabilities = result.capabilities
    this.connectionStatus.serverInfo = result.serverInfo

    logger.info(`Initialized MCP server ${this.config.name}:`, result.serverInfo)

    await this.sendNotification('notifications/initialized', {})
  }

  /**
   * Send a notification (no response expected)
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
   * Connect using Streamable HTTP transport (MCP 2025-03-26)
   */
  private async connectStreamableHttp(): Promise<void> {
    if (!this.config.url) {
      throw new McpError('URL required for Streamable HTTP transport')
    }

    logger.info(`Using Streamable HTTP transport for ${this.config.name}`)
  }

  /**
   * Send HTTP request with automatic retry for trailing slash handling
   */
  private async sendHttpRequest(request: JsonRpcRequest | any): Promise<void> {
    if (!this.config.url) {
      throw new McpError('URL required for HTTP transport')
    }

    const urlsToTry = [
      this.config.url,
      ...(this.config.url.endsWith('/') ? [] : [`${this.config.url}/`]),
      ...(this.config.url.endsWith('/') ? [this.config.url.slice(0, -1)] : []),
    ]

    let lastError: Error | null = null

    for (const [index, url] of urlsToTry.entries()) {
      try {
        await this.attemptHttpRequest(request, url, index === 0)

        if (index > 0) {
          logger.info(`[${this.config.name}] Updated URL from ${this.config.url} to ${url}`)
          this.config.url = url
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
   * Attempt HTTP request with specific URL
   */
  private async attemptHttpRequest(
    request: JsonRpcRequest | any,
    url: string,
    isOriginalUrl = true
  ): Promise<void> {
    if (!isOriginalUrl) {
      logger.info(`[${this.config.name}] Trying alternative URL format: ${url}`)
    }

    logger.info(`[${this.config.name}] Sending HTTP request:`, {
      method: 'POST',
      url,
      requestId: request.id,
      requestMethod: request.method,
    })

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

    logger.info(`[${this.config.name}] HTTP response:`, {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('Content-Type'),
    })

    if (!response.ok) {
      const responseText = await response.text().catch(() => 'Could not read response body')
      logger.error(`[${this.config.name}] HTTP request failed:`, {
        status: response.status,
        statusText: response.statusText,
        url,
        responseBody: responseText.substring(0, 500), // Limit to 500 chars
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
        logger.info(`[${this.config.name}] Parsing SSE response for request ${request.id}`)
        const responseText = await response.text()
        this.handleSseResponse(responseText, request.id)
      } else {
        logger.info(`[${this.config.name}] Received non-JSON response for request ${request.id}`, {
          contentType,
        })
      }
    }
  }

  /**
   * Handle JSON-RPC responsef
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

      logger.info(`[${this.config.name}] Parsed SSE response for request ${requestId}:`, {
        hasResult: !!responseData.result,
        hasError: !!responseData.error,
      })

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
        responseText: responseText.substring(0, 500), // First 500 chars for debugging
      })

      this.pendingRequests.delete(requestId)
      clearTimeout(pending.timeout)
      pending.reject(new McpError('Failed to parse SSE response'))
    }
  }

  /**
   * Check if server has specific capability
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
}
