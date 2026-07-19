import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { RateLimiter } from '@/lib/core/rate-limiter/rate-limiter'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter/storage'
import { getClientIp } from '@/lib/core/utils/request'

const logger = createLogger('AppsRateLimit')
const rateLimiter = new RateLimiter()

/** Stricter public apps gateway limits; fail closed when storage is unavailable. */
export const APPS_PUBLIC_IP_LIMIT: TokenBucketConfig = {
  maxTokens: 20,
  refillRate: 10,
  refillIntervalMs: 60_000,
}

export const APPS_PUBLIC_ACTION_LIMIT: TokenBucketConfig = {
  maxTokens: 30,
  refillRate: 15,
  refillIntervalMs: 60_000,
}

export const APPS_PREVIEW_ACTION_LIMIT: TokenBucketConfig = {
  maxTokens: 30,
  refillRate: 15,
  refillIntervalMs: 60_000,
}

function buildRateLimitResponse(resetAt: Date): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
  return NextResponse.json(
    { error: 'Rate limit exceeded', retryAfter: resetAt.getTime() },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Reset': resetAt.toISOString(),
      },
    }
  )
}

export async function enforceAppsIpRateLimit(
  bucketName: string,
  request: NextRequest,
  config: TokenBucketConfig = APPS_PUBLIC_IP_LIMIT
): Promise<NextResponse | null> {
  const ip = getClientIp(request)
  const key = `apps:${bucketName}:ip:${ip}`
  const { allowed, resetAt } = await rateLimiter.checkRateLimitDirect(key, config, {
    failClosed: true,
  })
  if (allowed) return null
  logger.warn('Apps IP rate limit exceeded (fail-closed)', { bucket: bucketName, ip })
  return buildRateLimitResponse(resetAt)
}

export async function enforceAppsActionRateLimit(
  releaseId: string,
  actionId: string,
  request: NextRequest
): Promise<NextResponse | null> {
  const ip = getClientIp(request)
  const key = `apps:action:${releaseId}:${actionId}:ip:${ip}`
  const { allowed, resetAt } = await rateLimiter.checkRateLimitDirect(
    key,
    APPS_PUBLIC_ACTION_LIMIT,
    {
      failClosed: true,
    }
  )
  if (allowed) return null
  logger.warn('Apps action rate limit exceeded', { releaseId, actionId, ip })
  return buildRateLimitResponse(resetAt)
}

export async function enforceAppsPreviewActionRateLimit(
  userId: string,
  projectId: string,
  actionId: string
): Promise<NextResponse | null> {
  const key = `apps:preview:${userId}:${projectId}:${actionId}`
  const { allowed, resetAt } = await rateLimiter.checkRateLimitDirect(
    key,
    APPS_PREVIEW_ACTION_LIMIT,
    { failClosed: true }
  )
  if (allowed) return null
  logger.warn('Apps preview action rate limit exceeded (fail-closed)', {
    userId,
    projectId,
    actionId,
  })
  return buildRateLimitResponse(resetAt)
}
