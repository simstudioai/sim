import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export type McpTransport = 'streamable-http'

/** `oauth` uses the SDK's authProvider; `headers` is a static map; `none` is unauthenticated. */
export type McpAuthType = 'none' | 'headers' | 'oauth'

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
  authType?: McpAuthType
  /**
   * Required when `authType === 'oauth'` — identifies whose stored tokens
   * to use when establishing the connection. Omit for header / none auth.
   */
  userId?: string
  workspaceId?: string
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

export interface McpToolSchemaProperty {
  type?: string | string[]
  description?: string
  items?: McpToolSchemaProperty
  properties?: Record<string, McpToolSchemaProperty>
  required?: string[]
  enum?: Array<string | number | boolean | null>
  default?: unknown
  [key: string]: unknown
}

/** Typed view of the SDK's `Tool.inputSchema` (which is `Record<string, unknown>`). */
export interface McpToolSchema {
  type: 'object'
  properties?: Record<string, McpToolSchemaProperty>
  required?: string[]
  description?: string
  [key: string]: unknown
}

/** SDK `Tool` plus the server context Sim tracks. */
export interface McpTool extends Pick<Tool, 'name' | 'description'> {
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

/**
 * Thrown when an OAuth-protected MCP server is reachable but the current
 * user has not yet authorized Sim. This is a benign "pending" state, not a
 * connection failure — callers should surface a re-auth prompt rather than
 * marking the server as errored.
 */
export class McpOauthAuthorizationRequiredError extends McpError {
  constructor(
    public readonly serverId: string,
    serverName: string
  ) {
    super(`OAuth authorization required for "${serverName}"`)
    this.name = 'McpOauthAuthorizationRequiredError'
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

/**
 * Callback invoked when an MCP server sends a `notifications/tools/list_changed` notification.
 */
export type McpToolsChangedCallback = (serverId: string) => void

/**
 * Options for creating an McpClient with notification support.
 */
export interface McpClientOptions {
  config: McpServerConfig
  securityPolicy?: McpSecurityPolicy
  onToolsChanged?: McpToolsChangedCallback
  /**
   * Pre-resolved IP address to pin all transport HTTP connections to. When
   * set, the SDK transport uses a custom fetch backed by an undici Agent with
   * a fixed DNS lookup, preventing DNS-rebinding (TOCTOU) attacks between
   * URL validation and connection. Should be supplied by callers that have
   * just validated the URL via `validateMcpServerSsrf`.
   */
  resolvedIP?: string
  /**
   * SDK-compatible OAuth client provider. When provided, the underlying
   * StreamableHTTPClientTransport delegates token discovery, refresh, and
   * 401 recovery to it. Should be supplied for `authType === 'oauth'`
   * server configs.
   */
  authProvider?: import('@modelcontextprotocol/sdk/client/auth.js').OAuthClientProvider
}

export interface ToolsChangedEvent {
  serverId: string
  serverName: string
  workspaceId: string
  timestamp: number
}

export interface ManagedConnectionState {
  serverId: string
  serverName: string
  workspaceId: string
  userId: string
  connected: boolean
  supportsListChanged: boolean
  reconnectAttempts: number
  lastActivity: number
}

export interface WorkflowToolsChangedEvent {
  serverId: string
  workspaceId: string
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
