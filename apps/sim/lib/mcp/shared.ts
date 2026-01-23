/**
 * Shared MCP utilities - safe for both client and server.
 * No server-side dependencies (database, fs, etc.) should be imported here.
 */

import { isMcpTool, MCP } from '@/executor/constants'

/**
 * Sanitizes a string by removing invisible Unicode characters that cause HTTP header errors.
 * Handles characters like U+2028 (Line Separator) that can be introduced via copy-paste.
 */
export function sanitizeForHttp(value: string): string {
  return value
    .replace(/[\u2028\u2029\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
}

/**
 * Sanitizes all header key-value pairs for HTTP usage.
 */
export function sanitizeHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return headers
  return Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [sanitizeForHttp(key), sanitizeForHttp(value)])
      .filter(([key, value]) => key !== '' && value !== '')
  )
}

/**
 * Client-safe MCP constants
 */
export const MCP_CLIENT_CONSTANTS = {
  CLIENT_TIMEOUT: 60000,
  MAX_RETRIES: 3,
  RECONNECT_DELAY: 1000,
} as const

/**
 * Create standardized MCP tool ID from server ID and tool name
 */
export function createMcpToolId(serverId: string, toolName: string): string {
  const normalizedServerId = isMcpTool(serverId) ? serverId : `${MCP.TOOL_PREFIX}${serverId}`
  return `${normalizedServerId}-${toolName}`
}

/**
 * Parse an MCP tool ID back into server ID and tool name
 */
export function parseMcpToolId(toolId: string): { serverId: string; toolName: string } {
  // Remove the MCP tool prefix if present to get the base ID
  const baseId = toolId.startsWith(MCP.TOOL_PREFIX) ? toolId.slice(MCP.TOOL_PREFIX.length) : toolId

  // Find the last hyphen to split server ID and tool name
  const lastHyphenIndex = baseId.lastIndexOf('-')
  if (lastHyphenIndex === -1) {
    return { serverId: baseId, toolName: '' }
  }

  const serverId = baseId.slice(0, lastHyphenIndex)
  const toolName = baseId.slice(lastHyphenIndex + 1)

  return { serverId, toolName }
}
