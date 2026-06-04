import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { createMcpErrorResponse } from '@/lib/mcp/utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('McpAuthMiddleware')
const MAX_MCP_MANAGEMENT_BODY_BYTES = 10 * 1024 * 1024
const parsedBodies = new WeakMap<NextRequest, unknown>()

export type McpPermissionLevel = 'read' | 'write' | 'admin'

export interface McpAuthContext {
  userId: string
  userName?: string | null
  userEmail?: string | null
  workspaceId: string
  requestId: string
}

export type McpRouteHandler<TParams = Record<string, string>> = (
  request: NextRequest,
  context: McpAuthContext,
  routeContext: { params: Promise<TParams> }
) => Promise<NextResponse>

interface AuthResult {
  success: true
  context: McpAuthContext
}

interface AuthFailure {
  success: false
  errorResponse: NextResponse
}

type AuthValidationResult = AuthResult | AuthFailure

class McpBodyReadError extends Error {
  constructor(
    readonly kind: 'aborted' | 'payload_too_large' | 'invalid_json',
    readonly cause: unknown
  ) {
    super(toError(cause).message)
    this.name = 'McpBodyReadError'
  }
}

export async function readMcpJsonBodyWithLimit(request: NextRequest): Promise<unknown> {
  const cached = parsedBodies.get(request)
  if (cached !== undefined) return cached

  try {
    assertContentLengthWithinLimit(
      request.headers,
      MAX_MCP_MANAGEMENT_BODY_BYTES,
      'MCP management request body'
    )
    const buffer = await readStreamToBufferWithLimit(request.body, {
      maxBytes: MAX_MCP_MANAGEMENT_BODY_BYTES,
      label: 'MCP management request body',
      signal: request.signal,
    })
    const body = buffer.byteLength > 0 ? JSON.parse(buffer.toString('utf-8')) : {}
    parsedBodies.set(request, body)
    return body
  } catch (error) {
    if (request.signal.aborted) {
      throw new McpBodyReadError('aborted', error)
    }
    if (isPayloadSizeLimitError(error)) {
      throw new McpBodyReadError('payload_too_large', error)
    }
    if (error instanceof SyntaxError) {
      throw new McpBodyReadError('invalid_json', error)
    }
    throw error
  }
}

export function mcpBodyReadErrorResponse(
  error: unknown,
  request?: NextRequest
): NextResponse | null {
  if (!(error instanceof McpBodyReadError)) {
    return null
  }
  if (error.kind === 'aborted' || request?.signal.aborted) {
    return createMcpErrorResponse(error.cause, 'Client cancelled request', 499)
  }
  if (error.kind === 'payload_too_large') {
    return createMcpErrorResponse(
      error.cause,
      'MCP management request body exceeds maximum size',
      413
    )
  }
  return createMcpErrorResponse(error.cause, 'Invalid request body', 400)
}

/**
 * Validates MCP authentication and authorization
 */
async function validateMcpAuth(
  request: NextRequest,
  permissionLevel: McpPermissionLevel
): Promise<AuthValidationResult> {
  const requestId = generateRequestId()

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Authentication failed: ${auth.error}`)
      return {
        success: false,
        errorResponse: createMcpErrorResponse(
          new Error(auth.error || 'Authentication required'),
          'Authentication failed',
          401
        ),
      }
    }

    let workspaceId: string | null = null

    const { searchParams } = new URL(request.url)
    workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) {
      try {
        const contentType = request.headers.get('content-type')
        if (contentType?.includes('application/json')) {
          const body = await readMcpJsonBodyWithLimit(request)
          const bodyWorkspaceId =
            body && typeof body === 'object' && 'workspaceId' in body
              ? (body as { workspaceId?: unknown }).workspaceId
              : undefined
          workspaceId = typeof bodyWorkspaceId === 'string' ? bodyWorkspaceId : null
        }
      } catch (error) {
        const errorResponse = mcpBodyReadErrorResponse(error, request)
        if (errorResponse) return { success: false, errorResponse }
      }
    }

    if (!workspaceId) {
      return {
        success: false,
        errorResponse: createMcpErrorResponse(
          new Error('workspaceId is required'),
          'Missing required parameter',
          400
        ),
      }
    }

    const userPermissions = await getUserEntityPermissions(auth.userId, 'workspace', workspaceId)
    if (!userPermissions) {
      return {
        success: false,
        errorResponse: createMcpErrorResponse(
          new Error('Access denied to workspace'),
          'Insufficient permissions',
          403
        ),
      }
    }

    const hasRequiredPermission = checkPermissionLevel(userPermissions, permissionLevel)
    if (!hasRequiredPermission) {
      const permissionError = getPermissionErrorMessage(permissionLevel)
      return {
        success: false,
        errorResponse: createMcpErrorResponse(
          new Error(permissionError),
          'Insufficient permissions',
          403
        ),
      }
    }

    return {
      success: true,
      context: {
        userId: auth.userId,
        userName: auth.userName,
        userEmail: auth.userEmail,
        workspaceId,
        requestId,
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error during MCP auth validation:`, error)
    return {
      success: false,
      errorResponse: createMcpErrorResponse(
        toError(error),
        'Authentication validation failed',
        500
      ),
    }
  }
}

/**
 * Check if user has required permission level
 */
function checkPermissionLevel(userPermission: string, requiredLevel: McpPermissionLevel): boolean {
  switch (requiredLevel) {
    case 'read':
      return ['read', 'write', 'admin'].includes(userPermission)
    case 'write':
      return ['write', 'admin'].includes(userPermission)
    case 'admin':
      return userPermission === 'admin'
    default:
      return false
  }
}

/**
 * Get appropriate error message for permission level
 */
function getPermissionErrorMessage(permissionLevel: McpPermissionLevel): string {
  switch (permissionLevel) {
    case 'read':
      return 'Workspace access required for MCP operations'
    case 'write':
      return 'Write or admin permission required for MCP server management'
    case 'admin':
      return 'Admin permission required for MCP server administration'
    default:
      return 'Insufficient permissions for MCP operation'
  }
}

/**
 * Higher-order function that wraps MCP route handlers with authentication middleware
 *
 * @param permissionLevel - Required permission level ('read', 'write', or 'admin')
 * @returns Middleware wrapper function
 *
 */
export function withMcpAuth<TParams = Record<string, string>>(
  permissionLevel: McpPermissionLevel = 'read'
) {
  return function middleware(handler: McpRouteHandler<TParams>) {
    return async function wrappedHandler(
      request: NextRequest,
      routeContext: { params: Promise<TParams> }
    ): Promise<NextResponse> {
      const authResult = await validateMcpAuth(request, permissionLevel)

      if (!authResult.success) {
        return (authResult as AuthFailure).errorResponse
      }

      try {
        return await handler(request, (authResult as AuthResult).context, routeContext)
      } catch (error) {
        const bodyErrorResponse = mcpBodyReadErrorResponse(error, request)
        if (bodyErrorResponse) return bodyErrorResponse
        logger.error(
          `[${(authResult as AuthResult).context.requestId}] Error in MCP route handler:`,
          error
        )
        return createMcpErrorResponse(toError(error), 'Internal server error', 500)
      }
    }
  }
}
