/**
 * Model Context Protocol (MCP) Types
 */

// MCP Transport Types
// Modern MCP uses Streamable HTTP which handles both HTTP POST and SSE responses
export type McpTransport = 'streamable-http'
export type McpServerKind = 'external' | 'hosted'

export interface McpServerConfig {
  id: string
  name: string
  description?: string
  kind?: McpServerKind
  projectId?: string
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

// Version negotiation support
export interface McpVersionInfo {
  supported: string[] // List of supported protocol versions
  preferred: string // Preferred version to use
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

// Connection and Error Types
export interface McpConnectionStatus {
  connected: boolean
  lastConnected?: Date
  lastError?: string
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

export interface McpServerSummary {
  id: string
  name: string
  kind?: McpServerKind
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

// Hosted server authoring types
export type McpServerProjectVisibility = 'private' | 'workspace' | 'public'
export type McpServerProjectStatus =
  | 'draft'
  | 'building'
  | 'deploying'
  | 'active'
  | 'failed'
  | 'archived'

export interface McpServerProject {
  id: string
  workspaceId: string
  createdBy?: string | null
  name: string
  slug: string
  description?: string | null
  visibility: McpServerProjectVisibility
  runtime: string
  entryPoint: string
  template?: string | null
  sourceType: 'inline' | 'repo' | 'package'
  repositoryUrl?: string | null
  repositoryBranch?: string | null
  environmentVariables: Record<string, string>
  metadata: Record<string, any>
  status: McpServerProjectStatus
  currentVersionNumber?: number | null
  lastDeployedVersionId?: string | null
  lastDeployedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export type McpServerVersionStatus = 'queued' | 'building' | 'ready' | 'failed' | 'deprecated'

export interface McpServerVersion {
  id: string
  projectId: string
  versionNumber: number
  sourceHash?: string | null
  manifest: Record<string, any>
  buildConfig: Record<string, any>
  artifactUrl?: string | null
  runtimeMetadata: Record<string, any>
  status: McpServerVersionStatus
  buildLogsUrl?: string | null
  changelog?: string | null
  promotedBy?: string | null
  promotedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export type McpServerDeploymentStatus =
  | 'pending'
  | 'deploying'
  | 'active'
  | 'failed'
  | 'decommissioned'

export interface McpServerDeployment {
  id: string
  projectId: string
  versionId?: string | null
  serverId?: string | null
  workspaceId: string
  environment: string
  region?: string | null
  endpointUrl?: string | null
  status: McpServerDeploymentStatus
  logsUrl?: string | null
  deployedBy?: string | null
  deployedAt?: string | null
  rolledBackAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export type McpServerTokenScope = 'deploy' | 'runtime' | 'logs'

export interface McpServerToken {
  id: string
  projectId: string
  name: string
  scope: McpServerTokenScope
  lastUsedAt?: string | null
  expiresAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface CreateMcpServerProjectInput {
  workspaceId: string
  createdBy: string
  name: string
  slug?: string
  description?: string
  visibility?: McpServerProjectVisibility
  runtime?: string
  entryPoint?: string
  template?: string
  sourceType?: 'inline' | 'repo' | 'package'
  repositoryUrl?: string
  repositoryBranch?: string
  environmentVariables?: Record<string, string>
  metadata?: Record<string, any>
}
