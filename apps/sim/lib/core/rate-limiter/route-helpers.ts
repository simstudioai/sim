import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { RateLimiter } from '@/lib/core/rate-limiter/rate-limiter'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter/storage'
import { getClientIp } from '@/lib/core/utils/request'

const logger = createLogger('RouteRateLimit')
const rateLimiter = new RateLimiter()

/** Default per-user bucket for authenticated tool routes (60 burst, 30/min). */
export const DEFAULT_USER_ROUTE_LIMIT: TokenBucketConfig = {
  maxTokens: 60,
  refillRate: 30,
  refillIntervalMs: 60_000,
}

/** Default per-IP bucket for unauthenticated public endpoints (10 burst, 5/min). */
export const DEFAULT_PUBLIC_IP_ROUTE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 5,
  refillIntervalMs: 60_000,
}

function buildRateLimitResponse(resetAt: Date): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      retryAfter: resetAt.getTime(),
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Reset': resetAt.toISOString(),
      },
    }
  )
}

/**
 * Apply a per-user token bucket to an authenticated route.
 * Returns a `NextResponse` on 429, otherwise `null` so the caller can proceed.
 */
export async function enforceUserRateLimit(
  bucketName: string,
  userId: string,
  config: TokenBucketConfig = DEFAULT_USER_ROUTE_LIMIT
): Promise<NextResponse | null> {
  const key = `route:${bucketName}:user:${userId}`
  const { allowed, resetAt } = await rateLimiter.checkRateLimitDirect(key, config)
  if (allowed) return null
  logger.warn('User rate limit exceeded', { bucket: bucketName, userId })
  return buildRateLimitResponse(resetAt)
}

/**
 * Apply a per-IP token bucket to an unauthenticated route. The `unknown` IP
 * fallback shares one global bucket per route so it cannot be amplified by
 * `X-Forwarded-For: unknown` spoofing.
 */
export async function enforceIpRateLimit(
  bucketName: string,
  request: NextRequest,
  config: TokenBucketConfig = DEFAULT_PUBLIC_IP_ROUTE_LIMIT
): Promise<NextResponse | null> {
  const ip = getClientIp(request)
  const key = `route:${bucketName}:ip:${ip}`
  const { allowed, resetAt } = await rateLimiter.checkRateLimitDirect(key, config)
  if (allowed) return null
  logger.warn('IP rate limit exceeded', { bucket: bucketName, ip })
  return buildRateLimitResponse(resetAt)
}

/**
 * Apply a per-user limit when a userId is present, else fall back to per-IP.
 * Use for routes whose auth path may legitimately resolve without a userId
 * (e.g. internal JWT calls with `requireWorkflowId: false`) so missing-userId
 * traffic is still throttled per-IP rather than sharing one global bucket.
 */
export async function enforceUserOrIpRateLimit(
  bucketName: string,
  userId: string | undefined,
  request: NextRequest,
  config: TokenBucketConfig = DEFAULT_USER_ROUTE_LIMIT
): Promise<NextResponse | null> {
  if (userId) return enforceUserRateLimit(bucketName, userId, config)
  return enforceIpRateLimit(bucketName, request, config)
}
