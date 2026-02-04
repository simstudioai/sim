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
 * Note: CLIENT_TIMEOUT should match DEFAULT_EXECUTION_TIMEOUT_MS from @/lib/core/execution-limits
 * (5 minutes = 300 seconds for free tier). Keep in sync if that value changes.
 */
export const MCP_CLIENT_CONSTANTS = {
  CLIENT_TIMEOUT: 5 * 60 * 1000, // 5 minutes - matches DEFAULT_EXECUTION_TIMEOUT_MS
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
