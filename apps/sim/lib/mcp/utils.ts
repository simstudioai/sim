import { NextResponse } from 'next/server'
import type { McpApiResponse } from '@/lib/mcp/types'

/**
 * MCP-specific constants
 */
export const MCP_CONSTANTS = {
  EXECUTION_TIMEOUT: 60000,
  CACHE_TIMEOUT: 5 * 60 * 1000,
  DEFAULT_RETRIES: 3,
  DEFAULT_CONNECTION_TIMEOUT: 30000,
} as const

/**
 * Client-safe MCP constants
 */
export const MCP_CLIENT_CONSTANTS = {
  CLIENT_TIMEOUT: 60000,
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
  const normalizedServerId = serverId.startsWith('mcp-') ? serverId : `mcp-${serverId}`
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
