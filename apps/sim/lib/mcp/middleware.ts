import { createLogger } from '@sim/logger'
import type { NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { createMcpErrorResponse } from '@/lib/mcp/utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('McpAuthMiddleware')

export type McpPermissionLevel = 'read' | 'write' | 'admin'

export interface McpAuthContext {
  userId: string
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
          const body = await request.json()
          workspaceId = body.workspaceId
          ;(request as any)._parsedBody = body
        }
      } catch (error) {
        logger.debug(`[${requestId}] Could not parse request body for workspaceId extraction`)
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
        workspaceId,
        requestId,
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error during MCP auth validation:`, error)
    return {
      success: false,
      errorResponse: createMcpErrorResponse(
        error instanceof Error ? error : new Error('Authentication validation failed'),
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
        logger.error(
          `[${(authResult as AuthResult).context.requestId}] Error in MCP route handler:`,
          error
        )
        return createMcpErrorResponse(
          error instanceof Error ? error : new Error('Internal server error'),
          'Internal server error',
          500
        )
      }
    }
  }
}

/**
 * Utility to get parsed request body
 */
export function getParsedBody(request: NextRequest): any {
  return (request as any)._parsedBody
}
