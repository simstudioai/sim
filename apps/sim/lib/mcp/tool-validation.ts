/**
 * MCP Tool Validation
 *
 * Shared logic for detecting issues with MCP tools across the platform.
 * Used by both tool-input.tsx (workflow context) and MCP modal (workspace context).
 */

import isEqual from 'lodash/isEqual'
import omit from 'lodash/omit'

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

export interface StoredMcpTool {
  serverId: string
  serverUrl?: string
  toolName: string
  schema?: Record<string, unknown>
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
  inputSchema?: Record<string, unknown>
}

/**
 * Compares two schemas to detect changes.
 * Uses lodash isEqual for deep, key-order-independent comparison.
 * Ignores description field which may be backfilled.
 */
export function hasSchemaChanged(
  storedSchema: Record<string, unknown> | undefined,
  serverSchema: Record<string, unknown> | undefined
): boolean {
  if (!storedSchema || !serverSchema) return false

  const storedWithoutDesc = omit(storedSchema, 'description')
  const serverWithoutDesc = omit(serverSchema, 'description')

  return !isEqual(storedWithoutDesc, serverWithoutDesc)
}

/**
 * Detects issues with a stored MCP tool by comparing against current server/tool state.
 */
export function getMcpToolIssue(
  storedTool: StoredMcpTool,
  servers: ServerState[],
  discoveredTools: DiscoveredTool[]
): McpToolIssue | null {
  const { serverId, serverUrl, toolName, schema } = storedTool

  // Check server exists
  const server = servers.find((s) => s.id === serverId)
  if (!server) {
    return { type: 'server_not_found', message: 'Server not found' }
  }

  // Check server connection status
  if (server.connectionStatus === 'error') {
    return { type: 'server_error', message: server.lastError || 'Server connection error' }
  }
  if (server.connectionStatus !== 'connected') {
    return { type: 'server_error', message: 'Server not connected' }
  }

  // Check server URL changed (if we have stored URL)
  if (serverUrl && server.url && serverUrl !== server.url) {
    return { type: 'url_changed', message: 'Server URL changed - tools may be different' }
  }

  // Check tool exists on server
  const serverTool = discoveredTools.find((t) => t.serverId === serverId && t.name === toolName)
  if (!serverTool) {
    return { type: 'tool_not_found', message: 'Tool not found on server' }
  }

  // Check schema changed
  if (schema && serverTool.inputSchema) {
    if (hasSchemaChanged(schema, serverTool.inputSchema)) {
      return { type: 'schema_changed', message: 'Tool schema changed' }
    }
  }

  return null
}

/**
 * Returns a user-friendly label for the issue badge
 */
export function getIssueBadgeLabel(issue: McpToolIssue): string {
  switch (issue.type) {
    case 'schema_changed':
      return 'stale'
    case 'url_changed':
      return 'stale'
    default:
      return 'unavailable'
  }
}

/**
 * Checks if an issue means the tool cannot be used (vs just being stale)
 */
export function isToolUnavailable(issue: McpToolIssue | null): boolean {
  if (!issue) return false
  return (
    issue.type === 'server_not_found' ||
    issue.type === 'server_error' ||
    issue.type === 'tool_not_found'
  )
}
