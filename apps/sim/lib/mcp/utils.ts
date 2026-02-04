import { NextResponse } from 'next/server'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import type { McpApiResponse } from '@/lib/mcp/types'
import { isMcpTool, MCP } from '@/executor/constants'

export const MCP_CONSTANTS = {
  EXECUTION_TIMEOUT: DEFAULT_EXECUTION_TIMEOUT_MS,
  CACHE_TIMEOUT: 5 * 60 * 1000,
  DEFAULT_RETRIES: 3,
  DEFAULT_CONNECTION_TIMEOUT: 30000,
  MAX_CACHE_SIZE: 1000,
  MAX_CONSECUTIVE_FAILURES: 3,
} as const

/**
 * Core MCP tool parameter keys that are metadata, not user-entered test values.
 * These should be preserved when cleaning up params during schema updates.
 */
export const MCP_TOOL_CORE_PARAMS = new Set(['serverId', 'serverUrl', 'toolName', 'serverName'])

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

export const MCP_CLIENT_CONSTANTS = {
  CLIENT_TIMEOUT: DEFAULT_EXECUTION_TIMEOUT_MS,
  AUTO_REFRESH_INTERVAL: 5 * 60 * 1000,
} as const

/**
 * Create standardized MCP error response
 */
export function createMcpErrorResponse(
  error: unknown,
  defaultMessage: string,
  status = 500
): NextResponse {
  const errorMessage = error instanceof Error ? error.message : defaultMessage

  const response: McpApiResponse = {
    success: false,
    error: errorMessage,
  }

  return NextResponse.json(response, { status })
}

/**
 * Create standardized MCP success response
 */
export function createMcpSuccessResponse<T>(data: T, status = 200): NextResponse {
  const response: McpApiResponse<T> = {
    success: true,
    data,
  }

  return NextResponse.json(response, { status })
}

/**
 * Validate string parameter
 * Consolidates parameter validation logic found across routes
 */
export function validateStringParam(
  value: unknown,
  paramName: string
): { isValid: true } | { isValid: false; error: string } {
  if (!value || typeof value !== 'string') {
    return {
      isValid: false,
      error: `${paramName} is required and must be a string`,
    }
  }
  return { isValid: true }
}

/**
 * Validate required fields in request body
 */
export function validateRequiredFields(
  body: Record<string, unknown>,
  requiredFields: string[]
): { isValid: true } | { isValid: false; error: string } {
  const missingFields = requiredFields.filter((field) => !(field in body))

  if (missingFields.length > 0) {
    return {
      isValid: false,
      error: `Missing required fields: ${missingFields.join(', ')}`,
    }
  }

  return { isValid: true }
}

/**
 * Enhanced error categorization for more specific HTTP status codes
 */
export function categorizeError(error: unknown): { message: string; status: number } {
  if (!(error instanceof Error)) {
    return { message: 'Unknown error occurred', status: 500 }
  }

  const message = error.message.toLowerCase()

  if (message.includes('timeout')) {
    return { message: 'Request timed out', status: 408 }
  }

  if (message.includes('not found') || message.includes('not accessible')) {
    return { message: error.message, status: 404 }
  }

  if (message.includes('authentication') || message.includes('unauthorized')) {
    return { message: 'Authentication required', status: 401 }
  }

  if (
    message.includes('invalid') ||
    message.includes('missing required') ||
    message.includes('validation')
  ) {
    return { message: error.message, status: 400 }
  }

  return { message: error.message, status: 500 }
}

/**
 * Create standardized MCP tool ID from server ID and tool name
 */
export function createMcpToolId(serverId: string, toolName: string): string {
  const normalizedServerId = isMcpTool(serverId) ? serverId : `${MCP.TOOL_PREFIX}${serverId}`
  return `${normalizedServerId}-${toolName}`
}

/**
 * Parse MCP tool ID to extract server ID and tool name
 */
export function parseMcpToolId(toolId: string): { serverId: string; toolName: string } {
  const parts = toolId.split('-')
  if (parts.length < 3 || parts[0] !== 'mcp') {
    throw new Error(`Invalid MCP tool ID format: ${toolId}. Expected: mcp-serverId-toolName`)
  }

  const serverId = `${parts[0]}-${parts[1]}`
  const toolName = parts.slice(2).join('-')

  return { serverId, toolName }
}

/**
 * Generate a deterministic MCP server ID based on workspace and URL.
 *
 * This ensures that re-adding the same MCP server (same URL in the same workspace)
 * produces the same ID, preventing "server not found" errors when workflows
 * reference the old server ID.
 *
 * The ID is a hash of: workspaceId + normalized URL
 * Format: mcp-<8 char hash>
 */
export function generateMcpServerId(workspaceId: string, url: string): string {
  const normalizedUrl = normalizeUrlForHashing(url)

  const input = `${workspaceId}:${normalizedUrl}`
  const hash = simpleHash(input)

  return `mcp-${hash}`
}

/**
 * Normalize URL for consistent hashing.
 * - Converts to lowercase
 * - Removes trailing slashes
 * - Removes query parameters and fragments
 */
function normalizeUrlForHashing(url: string): string {
  try {
    const parsed = new URL(url)
    const normalized = `${parsed.origin}${parsed.pathname}`.toLowerCase().replace(/\/+$/, '')
    return normalized
  } catch {
    return url.toLowerCase().trim().replace(/\/+$/, '')
  }
}

/**
 * Simple deterministic hash function that produces an 8-character hex string.
 * Uses a variant of djb2 hash algorithm.
 */
function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i)
    hash = hash >>> 0
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8)
}
