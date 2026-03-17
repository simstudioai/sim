import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter'
import { getRateLimit, RateLimiter } from '@/lib/core/rate-limiter'
import { authenticateV1Request } from '@/app/api/v1/auth'

const logger = createLogger('V1Middleware')
const rateLimiter = new RateLimiter()

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

export async function checkRateLimit(
  request: NextRequest,
  endpoint:
    | 'logs'
    | 'logs-detail'
    | 'workflows'
    | 'workflow-detail'
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
    | 'knowledge-search' = 'logs'
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

/** Verify that a workspace-scoped API key is only used for its own workspace. */
export function checkWorkspaceScope(
  rateLimit: RateLimitResult,
  requestedWorkspaceId: string
): NextResponse | null {
  if (
    rateLimit.keyType === 'workspace' &&
    rateLimit.workspaceId &&
    rateLimit.workspaceId !== requestedWorkspaceId
  ) {
    return NextResponse.json(
      { error: 'API key is not authorized for this workspace' },
      { status: 403 }
    )
  }
  return null
}
