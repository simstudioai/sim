import isEqual from 'lodash/isEqual'
import omit from 'lodash/omit'
import type { McpToolSchema, StoredMcpToolReference } from '@/lib/mcp/types'

export type McpToolIssueType =
  | 'server_not_found'
  | 'server_error'
  | 'tool_not_found'
  | 'schema_changed'
  | 'url_changed'

export interface McpToolIssue {
  type: McpToolIssueType
  message: string
}

export interface ServerState {
  id: string
  url?: string
  connectionStatus?: 'connected' | 'disconnected' | 'error'
  lastError?: string
}

export interface DiscoveredTool {
  serverId: string
  name: string
  inputSchema?: McpToolSchema
}

export function hasSchemaChanged(
  storedSchema: McpToolSchema | undefined,
  serverSchema: McpToolSchema | undefined
): boolean {
  if (!storedSchema || !serverSchema) return false

  const storedWithoutDesc = omit(storedSchema, 'description')
  const serverWithoutDesc = omit(serverSchema, 'description')

  return !isEqual(storedWithoutDesc, serverWithoutDesc)
}

export function getMcpToolIssue(
  storedTool: StoredMcpToolReference,
  servers: ServerState[],
  discoveredTools: DiscoveredTool[]
): McpToolIssue | null {
  const { serverId, serverUrl, toolName, schema } = storedTool

  const server = servers.find((s) => s.id === serverId)
  if (!server) {
    return { type: 'server_not_found', message: 'Server not found' }
  }

  if (server.connectionStatus === 'error') {
    return { type: 'server_error', message: server.lastError || 'Server connection error' }
  }
  if (server.connectionStatus !== 'connected') {
    return { type: 'server_error', message: 'Server not connected' }
  }

  if (serverUrl && server.url && serverUrl !== server.url) {
    return { type: 'url_changed', message: 'Server URL changed' }
  }

  const serverTool = discoveredTools.find((t) => t.serverId === serverId && t.name === toolName)
  if (!serverTool) {
    return { type: 'tool_not_found', message: 'Tool not found on server' }
  }

  if (schema && serverTool.inputSchema) {
    if (hasSchemaChanged(schema, serverTool.inputSchema)) {
      return { type: 'schema_changed', message: 'Tool schema changed' }
    }
  }

  return null
}

export function getIssueBadgeLabel(issue: McpToolIssue): string {
  switch (issue.type) {
    case 'schema_changed':
    case 'url_changed':
      return 'stale'
    default:
      return 'unavailable'
  }
}

export function getIssueBadgeVariant(issue: McpToolIssue): 'amber' | 'red' {
  switch (issue.type) {
    case 'schema_changed':
    case 'url_changed':
      return 'amber'
    default:
      return 'red'
  }
}

export function isToolUnavailable(issue: McpToolIssue | null): boolean {
  if (!issue) return false
  return (
    issue.type === 'server_not_found' ||
    issue.type === 'server_error' ||
    issue.type === 'tool_not_found'
  )
}
