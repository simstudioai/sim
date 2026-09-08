import { NextResponse } from 'next/server'
import { RateLimiter, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { getClientIp } from '@/lib/core/utils/request'
import { MAX_EMBEDDED_IMAGES } from '@/lib/uploads/server/embedded-image-refs'

const rateLimiter = new RateLimiter()

const PUBLIC_FILE_RATE_LIMITS = {
  metadata: { maxTokens: 120, refillRate: 120, refillIntervalMs: 60_000 },
  content: { maxTokens: 60, refillRate: 60, refillIntervalMs: 60_000 },
  /** Allow three image-heavy page loads in a burst without consuming the document's budget. */
  inline: {
    maxTokens: MAX_EMBEDDED_IMAGES * 3,
    refillRate: 60,
    refillIntervalMs: 60_000,
  },
} satisfies Record<string, TokenBucketConfig>

/**
 * Per-IP rate limit for the unauthenticated public share endpoints, returning a
 * `429` response when exceeded (or `null` to proceed). The token is unguessable,
 * so this defends a *known* link against hammering (DoS / S3 egress) rather than
 * enumeration. Fails open on storage errors (availability over strictness), but
 * fails closed when the forwarded chain cannot identify a safe client key.
 */
export async function enforcePublicFileRateLimit(
  request: { headers: { get(name: string): string | null } },
  scope: keyof typeof PUBLIC_FILE_RATE_LIMITS
): Promise<NextResponse | null> {
  const config = PUBLIC_FILE_RATE_LIMITS[scope]
  const ip = getClientIp(request)
  if (!ip) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(config.refillIntervalMs / 1000) } }
    )
  }
  const result = await rateLimiter.checkRateLimitDirect(`public-file:${scope}:${ip}`, config)
  if (result.allowed) return null

  const headers =
    result.retryAfterMs != null
      ? { 'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)) }
      : undefined
  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    { status: 429, headers }
  )
}
