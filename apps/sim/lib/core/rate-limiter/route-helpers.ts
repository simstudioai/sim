import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { normalizeEmail } from '@sim/utils/string'
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

async function enforceIpRateLimitWithPolicy(
  bucketName: string,
  request: NextRequest,
  config: TokenBucketConfig,
  unresolvedClientPolicy: 'deny' | 'defer',
  resourceId?: string
): Promise<NextResponse | null> {
  const ip = getClientIp(request)
  if (!ip) {
    logger.warn('Unable to resolve client IP for public rate limit', {
      bucket: bucketName,
      resourceId,
      unresolvedClientPolicy,
    })
    return unresolvedClientPolicy === 'deny'
      ? buildRateLimitResponse(new Date(Date.now() + config.refillIntervalMs))
      : null
  }
  const scope = resourceId ? `resource:${resourceId}:` : ''
  const key = `route:${bucketName}:${scope}ip:${ip}`
  const { allowed, resetAt } = await rateLimiter.checkRateLimitDirect(key, config)
  if (allowed) return null
  logger.warn('IP rate limit exceeded', { bucket: bucketName, resourceId, ip })
  return buildRateLimitResponse(resetAt)
}

/** Apply a per-IP token bucket and fail closed when the client cannot be resolved safely. */
export async function enforceIpRateLimit(
  bucketName: string,
  request: NextRequest,
  config: TokenBucketConfig = DEFAULT_PUBLIC_IP_ROUTE_LIMIT
): Promise<NextResponse | null> {
  return enforceIpRateLimitWithPolicy(bucketName, request, config, 'deny')
}

/**
 * Apply a per-IP bucket when resolvable, deferring unresolved clients to an
 * independent non-IP limit that the caller must enforce before any side effect.
 *
 * Pass `resourceId` to give each resource its own per-IP budget — the caller
 * that pairs this with {@link enforceResourceRateLimit} wants both scoped the
 * same way. It belongs here rather than interpolated into `bucketName`, which
 * is emitted as a log field and has to stay low-cardinality.
 */
export async function enforceIpRateLimitWithIndependentBackstop(
  bucketName: string,
  request: NextRequest,
  config: TokenBucketConfig = DEFAULT_PUBLIC_IP_ROUTE_LIMIT,
  resourceId?: string
): Promise<NextResponse | null> {
  return enforceIpRateLimitWithPolicy(bucketName, request, config, 'defer', resourceId)
}

/**
 * Apply a per-recipient token bucket to a route that mails an address the
 * caller chooses. A per-IP bucket cannot stop a distributed attempt to bomb one
 * mailbox, so the address needs a budget of its own.
 *
 * The address is normalized (case variants must not each buy a fresh budget)
 * and hashed, so the store never holds an address and long inputs cannot
 * inflate key cardinality.
 */
export async function enforceRecipientRateLimit(
  bucketName: string,
  email: string,
  config: TokenBucketConfig
): Promise<NextResponse | null> {
  const key = `route:${bucketName}:recipient:${sha256Hex(normalizeEmail(email))}`
  const { allowed, resetAt } = await rateLimiter.checkRateLimitDirect(key, config)
  if (allowed) return null
  logger.warn('Recipient rate limit exceeded', { bucket: bucketName })
  return buildRateLimitResponse(resetAt)
}

/**
 * Apply a token bucket to one resource, independently of who is calling.
 *
 * The backstop for a cost borne by a resource's owner rather than by its
 * caller: a deployed chat runs its owner's workflow on their plan bucket,
 * credits and concurrency reservation for anyone holding the link, so a per-IP
 * limit alone leaves the owner exposed to attempts spread across addresses and
 * to callers whose proxy chain resolves to no IP at all. Pair it with
 * {@link enforceIpRateLimitWithIndependentBackstop}, which is the "deferring
 * unresolved clients to an independent non-IP limit" half of the same shape.
 *
 * Consult the per-IP bucket first and return on its refusal: debiting both
 * unconditionally would let one flooding IP drain the resource's budget at full
 * speed and 429 the legitimate audience with it.
 */
export async function enforceResourceRateLimit(
  bucketName: string,
  resourceId: string,
  config: TokenBucketConfig
): Promise<NextResponse | null> {
  const key = `route:${bucketName}:resource:${resourceId}`
  const { allowed, resetAt } = await rateLimiter.checkRateLimitDirect(key, config)
  if (allowed) return null
  logger.warn('Resource rate limit exceeded', { bucket: bucketName, resourceId })
  return buildRateLimitResponse(resetAt)
}

/**
 * Apply a per-workspace token bucket. Use for routes whose cost is borne by the
 * workspace rather than the acting user — a shared budget any member spends
 * against, so N admins cannot each get a full allowance.
 */
export async function enforceWorkspaceRateLimit(
  bucketName: string,
  workspaceId: string,
  config: TokenBucketConfig = DEFAULT_USER_ROUTE_LIMIT
): Promise<NextResponse | null> {
  const key = `route:${bucketName}:workspace:${workspaceId}`
  const { allowed, resetAt } = await rateLimiter.checkRateLimitDirect(key, config)
  if (allowed) return null
  logger.warn('Workspace rate limit exceeded', { bucket: bucketName, workspaceId })
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
