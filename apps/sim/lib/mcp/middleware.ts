import { createLogger } from '@sim/logger'
import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'
import { toError } from '@sim/utils/errors'
import type { NextRequest, NextResponse } from 'next/server'
import {
  type AuthTypeValue,
  capabilityGovernedAuthUserId,
  checkSessionOrInternalAuth,
  type AuthResult as HybridAuthResult,
} from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { createMcpErrorResponse } from '@/lib/mcp/utils'
import type { StaticPermissionGroupCapability } from '@/lib/permission-groups/capabilities'
import {
  capabilityRefusal,
  isWorkspaceCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('McpAuthMiddleware')
const MAX_MCP_MANAGEMENT_BODY_BYTES = 10 * 1024 * 1024
const parsedBodies = new WeakMap<NextRequest, unknown>()

export type McpPermissionLevel = 'read' | 'write' | 'admin'

/**
 * The permission-group capability an MCP management route requires, or `'none'`
 * when no group governs it.
 *
 * Required at every call site, and `'none'` spelled out rather than omitted,
 * for the same reason `capability` is required on `defineWorkspaceOperation`
 * and on `V1RouteCapability` in the v1 middleware: an absent declaration cannot be told apart
 * from an unreviewed one. That is exactly how this surface came to gate
 * `deploy.mcp` on one of its thirteen routes — the create handler grew an
 * inline check and its twelve siblings, including the one that flips a server
 * public, silently did not.
 *
 * Each route's value is the one its `/api/v2` twin already declares in
 * `mcpServerOperations`; this surface does not get a mapping of its own.
 */
export type McpRouteCapability = StaticPermissionGroupCapability | 'none'

/**
 * The permission-group gate for an MCP management route.
 *
 * Only a user-bearing credential carries capabilities.
 * `checkSessionOrInternalAuth` rejects `x-api-key` outright, so the two kinds
 * that reach here are a browser session and the executor's internal JWT — and
 * the JWT's `userId` is the subject the executor embedded, a value that must not
 * hand the run's actor's grants to a caller the executor exemption deliberately
 * passes ungated. {@link capabilityGovernedAuthUserId} is the one place that
 * distinction is read, so this cannot drift from the funnel's own rule.
 *
 * Never called before the role check. A capability refusal handed to a
 * non-member would confirm the workspace exists and disclose which modules the
 * organization withholds; the role failure conceals both.
 */
async function capabilityRefusalResponse(
  auth: HybridAuthResult,
  workspaceId: string,
  capability: McpRouteCapability
): Promise<NextResponse | null> {
  if (capability === 'none') return null
  const userId = capabilityGovernedAuthUserId(auth)
  if (!userId) return null
  if (!(await isWorkspaceCapabilityWithheld(userId, workspaceId, capability))) return null

  logger.warn('MCP request blocked by permission group', { workspaceId, userId, capability })
  return createMcpErrorResponse(null, capabilityRefusal(capability), 403)
}

export interface McpAuthContext {
  userId: string
  userName?: string | null
  userEmail?: string | null
  authType?: AuthTypeValue
  workspaceId: string
  requestId: string
  /**
   * The caller's resolved workspace permission, which satisfies but may exceed
   * the level the route demanded — a `read` route still serves editors and
   * admins. Surfaces use it to decide how much of a row to project.
   */
  permission?: PermissionType
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
  permissionLevel: McpPermissionLevel,
  capability: McpRouteCapability
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

    const capabilityFailure = await capabilityRefusalResponse(auth, workspaceId, capability)
    if (capabilityFailure) {
      return { success: false, errorResponse: capabilityFailure }
    }

    return {
      success: true,
      context: {
        userId: auth.userId,
        userName: auth.userName,
        userEmail: auth.userEmail,
        authType: auth.authType,
        workspaceId,
        requestId,
        permission: userPermissions,
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
  return permissionSatisfies(userPermission as PermissionType, requiredLevel)
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
 * @param capability - The permission-group capability the route requires, or
 *   `'none'` with a reason. See {@link McpRouteCapability}.
 * @returns Middleware wrapper function
 */
export function withMcpAuth<TParams = Record<string, string>>(
  permissionLevel: McpPermissionLevel,
  capability: McpRouteCapability
) {
  return function middleware(handler: McpRouteHandler<TParams>) {
    return async function wrappedHandler(
      request: NextRequest,
      routeContext: { params: Promise<TParams> }
    ): Promise<NextResponse> {
      const authResult = await validateMcpAuth(request, permissionLevel, capability)

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
