/**
 * Model Context Protocol (MCP) Types
 *
 * Type definitions for JSON-RPC 2.0 based MCP implementation
 * Supporting HTTP/SSE and Streamable HTTP transports
 */

// JSON-RPC 2.0 Base Types
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: any
}

export interface JsonRpcResponse<T = any> {
  jsonrpc: '2.0'
  id: string | number
  result?: T
  error?: JsonRpcError
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}

export interface JsonRpcError {
  code: number
  message: string
  data?: any
}

// MCP Transport Types
export type McpTransport = 'http' | 'sse' | 'streamable-http'

export interface McpServerConfig {
  id: string
  name: string
  description?: string
  transport: McpTransport

  // HTTP/SSE transport config
  url?: string
  headers?: Record<string, string>

  // Common config
  timeout?: number
  retries?: number
  enabled?: boolean
  createdAt?: string
  updatedAt?: string
}

// MCP Protocol Types
export interface McpCapabilities {
  tools?: {
    listChanged?: boolean
  }
  resources?: {
    subscribe?: boolean
    listChanged?: boolean
  }
  prompts?: {
    listChanged?: boolean
  }
  logging?: Record<string, any>
}

export interface McpInitializeParams {
  protocolVersion: string
  capabilities: McpCapabilities
  clientInfo: {
    name: string
    version: string
  }
}

// Version negotiation support
export interface McpVersionInfo {
  supported: string[] // List of supported protocol versions
  preferred: string // Preferred version to use
}

export interface McpVersionNegotiationError extends JsonRpcError {
  code: -32000 // Custom error code for version negotiation failures
  message: 'Version negotiation failed'
  data: {
    clientVersions: string[]
    serverVersions: string[]
    reason: string
  }
}

export interface McpInitializeResult {
  protocolVersion: string
  capabilities: McpCapabilities
  serverInfo: {
    name: string
    version: string
  }
}

// Security and Consent Framework
export interface McpConsentRequest {
  type: 'tool_execution' | 'resource_access' | 'data_sharing'
  context: {
    serverId: string
    serverName: string
    action: string // Tool name or resource path
    description?: string // Human-readable description
    dataAccess?: string[] // Types of data being accessed
    sideEffects?: string[] // Potential side effects
  }
  expires?: number // Consent expiration timestamp
}

export interface McpConsentResponse {
  granted: boolean
  expires?: number
  restrictions?: Record<string, any> // Any access restrictions
  auditId?: string // For audit trail
}

export interface McpSecurityPolicy {
  requireConsent: boolean
  allowedOrigins?: string[]
  blockedOrigins?: string[]
  maxToolExecutionsPerHour?: number
  auditLevel: 'none' | 'basic' | 'detailed'
}

// MCP Tool Types
export interface McpToolSchema {
  type: string
  properties?: Record<string, any>
  required?: string[]
  additionalProperties?: boolean
  description?: string
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: McpToolSchema
  serverId: string
  serverName: string
}

export interface McpToolCall {
  name: string
  arguments: Record<string, any>
}

// Standard MCP protocol response format
export interface McpToolResult {
  content?: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
  // Allow additional fields that some MCP servers return
  [key: string]: any
}

// MCP Resource Types
export interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpResourceContent {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

// MCP Prompt Types
export interface McpPrompt {
  name: string
  description?: string
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: {
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }
}

// Connection and Error Types
export interface McpConnectionStatus {
  connected: boolean
  lastConnected?: Date
  lastError?: string
  serverInfo?: McpInitializeResult['serverInfo']
}

export class McpError extends Error {
  constructor(
    message: string,
    public code?: number,
    public data?: any
  ) {
    super(message)
    this.name = 'McpError'
  }
}

export class McpConnectionError extends McpError {
  constructor(message: string, serverId: string) {
    super(`MCP Connection Error for server ${serverId}: ${message}`)
    this.name = 'McpConnectionError'
  }
}

export class McpTimeoutError extends McpError {
  constructor(serverId: string, timeout: number) {
    super(`MCP request to server ${serverId} timed out after ${timeout}ms`)
    this.name = 'McpTimeoutError'
  }
}

// Integration Types (for existing platform)
export interface McpToolInput {
  type: 'mcp'
  serverId: string
  toolName: string
  params: Record<string, any>
  usageControl?: 'auto' | 'force' | 'none'
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

// API Response Types
export interface McpApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

export interface McpToolDiscoveryResponse {
  tools: McpTool[]
  totalCount: number
  byServer: Record<string, number>
}
