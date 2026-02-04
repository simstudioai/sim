/**
 * MCP Types - for connecting to external MCP servers
 */

export type McpTransport = 'streamable-http'

export interface McpServerStatusConfig {
  consecutiveFailures: number
  lastSuccessfulDiscovery: string | null
}

export interface McpServerConfig {
  id: string
  name: string
  description?: string
  transport: McpTransport
  url?: string
  headers?: Record<string, string>
  timeout?: number
  retries?: number
  enabled?: boolean
  statusConfig?: McpServerStatusConfig
  createdAt?: string
  updatedAt?: string
}

export interface McpVersionInfo {
  supported: string[]
  preferred: string
}

export interface McpConsentRequest {
  type: 'tool_execution' | 'resource_access' | 'data_sharing'
  context: {
    serverId: string
    serverName: string
    action: string
    description?: string
    dataAccess?: string[]
    sideEffects?: string[]
  }
  expires?: number
}

export interface McpConsentResponse {
  granted: boolean
  expires?: number
  restrictions?: Record<string, unknown>
  auditId?: string
}

export interface McpSecurityPolicy {
  requireConsent: boolean
  allowedOrigins?: string[]
  blockedOrigins?: string[]
  maxToolExecutionsPerHour?: number
  auditLevel: 'none' | 'basic' | 'detailed'
}

/**
 * JSON Schema property definition for tool parameters.
 * Follows JSON Schema specification with description support.
 */
export interface McpToolSchemaProperty {
  type: string
  description?: string
  items?: McpToolSchemaProperty
  properties?: Record<string, McpToolSchemaProperty>
  required?: string[]
  enum?: Array<string | number | boolean>
  default?: unknown
}

/**
 * JSON Schema for tool input parameters.
 * Aligns with MCP SDK's Tool.inputSchema structure.
 */
export interface McpToolSchema {
  type: 'object'
  properties?: Record<string, McpToolSchemaProperty>
  required?: string[]
  description?: string
}

/**
 * MCP Tool with server context.
 * Extends the SDK's Tool type with app-specific server tracking.
 */
export interface McpTool {
  name: string
  description?: string
  inputSchema: McpToolSchema
  serverId: string
  serverName: string
}

export interface McpToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface McpToolResult {
  content?: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
  [key: string]: unknown
}

export interface McpConnectionStatus {
  connected: boolean
  lastConnected?: Date
  lastError?: string
}

export class McpError extends Error {
  constructor(
    message: string,
    public code?: number,
    public data?: unknown
  ) {
    super(message)
    this.name = 'McpError'
  }
}

export class McpConnectionError extends McpError {
  constructor(message: string, serverName: string) {
    super(`Failed to connect to "${serverName}": ${message}`)
    this.name = 'McpConnectionError'
  }
}

export interface McpServerSummary {
  id: string
  name: string
  url?: string
  transport?: McpTransport
  status: 'connected' | 'disconnected' | 'error'
  toolCount: number
  resourceCount?: number
  promptCount?: number
  lastSeen?: Date
  error?: string
}

export interface McpApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface McpToolDiscoveryResponse {
  tools: McpTool[]
  totalCount: number
  byServer: Record<string, number>
}

/**
 * MCP tool reference stored in workflow blocks (for validation).
 * Minimal version used for comparing against discovered tools.
 */
export interface StoredMcpToolReference {
  serverId: string
  serverUrl?: string
  toolName: string
  schema?: McpToolSchema
}

/**
 * Full stored MCP tool with workflow context (for API responses).
 * Extended version that includes which workflow the tool is used in.
 */
export interface StoredMcpTool extends StoredMcpToolReference {
  workflowId: string
  workflowName: string
}
