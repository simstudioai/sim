/**
 * Shared MCP utilities - safe for both client and server.
 * No server-side dependencies (database, fs, etc.) should be imported here.
 */

import { isMcpTool, MCP } from '@/executor/constants'

export const MCP_SERVER_ADVANCED_TOOL_TYPE = 'mcp-server-advanced' as const

export interface McpServerAdvancedToolBinding {
  type: typeof MCP_SERVER_ADVANCED_TOOL_TYPE
  params: {
    serverId: string
  }
  usageControl?: 'auto' | 'force' | 'none'
}

export function isMcpServerAdvancedToolBinding(
  value: unknown
): value is McpServerAdvancedToolBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const binding = value as { type?: unknown; params?: unknown }
  if (binding.type !== MCP_SERVER_ADVANCED_TOOL_TYPE) return false
  if (!binding.params || typeof binding.params !== 'object' || Array.isArray(binding.params)) {
    return false
  }
  const serverId = (binding.params as { serverId?: unknown }).serverId
  return typeof serverId === 'string' && serverId.trim().length > 0
}

/** Rejects ambiguous server-wide bindings while leaving legacy MCP entries untouched. */
export function assertValidMcpServerToolBindings(value: unknown): void {
  if (!Array.isArray(value)) return
  const advancedServerIds = new Set<string>()
  const individualServerIds = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const tool = candidate as {
      type?: unknown
      usageControl?: unknown
      params?: { serverId?: unknown }
    }
    if (tool.usageControl === 'none') continue
    if (tool.type === 'mcp') {
      if (typeof tool.params?.serverId === 'string' && tool.params.serverId) {
        individualServerIds.add(tool.params.serverId)
      }
      continue
    }
    if (tool.type !== MCP_SERVER_ADVANCED_TOOL_TYPE) continue
    const serverId = tool.params?.serverId
    if (typeof serverId !== 'string' || !serverId.trim()) {
      throw new Error('MCP Server (Advanced) requires params.serverId')
    }
    if (advancedServerIds.has(serverId)) {
      throw new Error(`Duplicate MCP Server (Advanced) binding for ${serverId}`)
    }
    advancedServerIds.add(serverId)
  }
  for (const serverId of advancedServerIds) {
    if (individualServerIds.has(serverId)) {
      throw new Error(
        `MCP server ${serverId} cannot be attached as both an advanced server and individual tools`
      )
    }
  }
}

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
