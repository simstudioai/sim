import { createLogger } from '@sim/logger'
import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'
import { type NextRequest, NextResponse } from 'next/server'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter'
import { getRateLimit, RateLimiter } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceBillingSettings } from '@/lib/workspaces/utils'
import { authenticateV1Request } from '@/app/api/v1/auth'

const logger = createLogger('V1Middleware')
const rateLimiter = new RateLimiter()

export type V1Endpoint =
  | 'logs'
  | 'logs-detail'
  | 'workflows'
  | 'workflow-detail'
  | 'workflow-deploy'
  | 'workflow-rollback'
  | 'audit-logs'
  | 'tables'
  | 'table-detail'
  | 'table-rows'
  | 'table-row-detail'
  | 'table-columns'
  | 'files'
  | 'file-detail'
  | 'knowledge'
  | 'knowledge-detail'
  | 'knowledge-search'
  | 'copilot-chat'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  limit: number
  retryAfterMs?: number
  userId?: string
  workspaceId?: string
  keyType?: 'personal' | 'workspace'
  error?: string
}

export interface AuthorizedRequest {
  requestId: string
  userId: string
  rateLimit: RateLimitResult
}

export async function checkRateLimit(
  request: NextRequest,
  endpoint: V1Endpoint = 'logs'
): Promise<RateLimitResult> {
  try {
    const auth = await authenticateV1Request(request)
    if (!auth.authenticated) {
      return {
        allowed: false,
        remaining: 0,
        limit: 10,
        resetAt: new Date(),
        error: auth.error,
      }
    }

    const userId = auth.userId!
    const subscription = await getHighestPrioritySubscription(userId)

    const result = await rateLimiter.checkRateLimitWithSubscription(
      userId,
      subscription,
      'api-endpoint',
      false
    )

    if (!result.allowed) {
      logger.warn(`Rate limit exceeded for user ${userId}`, {
        endpoint,
        remaining: result.remaining,
        resetAt: result.resetAt,
      })
    }

    const plan = (subscription?.plan || 'free') as SubscriptionPlan
    const config = getRateLimit(plan, 'api-endpoint')

    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: result.resetAt,
      limit: config.refillRate,
      retryAfterMs: result.retryAfterMs,
      userId,
      workspaceId: auth.workspaceId,
      keyType: auth.keyType,
    }
  } catch (error) {
    logger.error('Rate limit check error', { error })
    return {
      allowed: false,
      remaining: 0,
      limit: 10,
      resetAt: new Date(Date.now() + 60000),
      error: 'Rate limit check failed',
    }
  }
}

/**
 * Authenticates and rate-limits a v1 API request.
 * Returns NextResponse on failure, AuthorizedRequest on success.
 */
export async function authenticateRequest(
  request: NextRequest,
  endpoint: V1Endpoint
): Promise<AuthorizedRequest | NextResponse> {
  const requestId = generateRequestId()
  const rateLimit = await checkRateLimit(request, endpoint)
  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit)
  }
  return { requestId, userId: rateLimit.userId!, rateLimit }
}

export function createRateLimitResponse(result: RateLimitResult): NextResponse {
  const headers = {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetAt.toISOString(),
  }

  if (result.error) {
    return NextResponse.json({ error: result.error || 'Unauthorized' }, { status: 401, headers })
  }

  const retryAfterSeconds = result.retryAfterMs
    ? Math.ceil(result.retryAfterMs / 1000)
    : Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)

  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      message: `API rate limit exceeded. Please retry after ${result.resetAt.toISOString()}`,
      retryAfter: result.resetAt.getTime(),
    },
    {
      status: 429,
      headers: {
        ...headers,
        'Retry-After': retryAfterSeconds.toString(),
      },
    }
  )
}

/**
 * Structured workspace-access failure shared by the v1 and v2 API surfaces so
 * each version can render the failure in its own response envelope.
 */
export interface WorkspaceAccessError {
  status: number
  code: 'FORBIDDEN'
  message: string
}

/**
 * Core workspace-scope check (no response rendering). Enforces two policies:
 * - A workspace-scoped key may only target its own workspace.
 * - A personal key is rejected when the workspace has disabled personal API
 *   keys (`allowPersonalApiKeys = false`), matching the workflow-execution
 *   surface in `app/api/workflows/middleware.ts`.
 */
export async function resolveWorkspaceScope(
  rateLimit: RateLimitResult,
  requestedWorkspaceId: string
): Promise<WorkspaceAccessError | null> {
  if (
    rateLimit.keyType === 'workspace' &&
    rateLimit.workspaceId &&
    rateLimit.workspaceId !== requestedWorkspaceId
  ) {
    return {
      status: 403,
      code: 'FORBIDDEN',
      message: 'API key is not authorized for this workspace',
    }
  }

  if (rateLimit.keyType === 'personal') {
    const settings = await getWorkspaceBillingSettings(requestedWorkspaceId)
    if (!settings?.allowPersonalApiKeys) {
      return {
        status: 403,
        code: 'FORBIDDEN',
        message: 'Personal API keys are not allowed for this workspace',
      }
    }
  }

  return null
}

/**
 * Core workspace-access check (scope + the user's workspace permission level),
 * shared by v1 and v2. Returns a structured failure or null on success.
 */
export async function resolveWorkspaceAccess(
  rateLimit: RateLimitResult,
  userId: string,
  workspaceId: string,
  level: PermissionType = 'read'
): Promise<WorkspaceAccessError | null> {
  const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
  if (scopeError) return scopeError

  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permissionSatisfies(permission, level)) {
    return { status: 403, code: 'FORBIDDEN', message: 'Access denied' }
  }
  return null
}

/**
 * v1 wrapper: renders {@link resolveWorkspaceScope} as the v1 `{ error }` body.
 */
export async function checkWorkspaceScope(
  rateLimit: RateLimitResult,
  requestedWorkspaceId: string
): Promise<NextResponse | null> {
  const failure = await resolveWorkspaceScope(rateLimit, requestedWorkspaceId)
  return failure ? NextResponse.json({ error: failure.message }, { status: failure.status }) : null
}

/**
 * v1 wrapper: renders {@link resolveWorkspaceAccess} as the v1 `{ error }` body.
 * Returns null on success, NextResponse on failure.
 */
export async function validateWorkspaceAccess(
  rateLimit: RateLimitResult,
  userId: string,
  workspaceId: string,
  level: PermissionType = 'read'
): Promise<NextResponse | null> {
  const failure = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, level)
  return failure ? NextResponse.json({ error: failure.message }, { status: failure.status }) : null
}
