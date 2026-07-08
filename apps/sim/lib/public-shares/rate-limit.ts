import { NextResponse } from 'next/server'
import { RateLimiter, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { getClientIp } from '@/lib/core/utils/request'

const rateLimiter = new RateLimiter()

/** Metadata reads are cheap (one indexed lookup) — generous per-IP budget. */
const METADATA_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 120,
  refillRate: 120,
  refillIntervalMs: 60_000,
}

/** Content reads stream bytes from storage (S3 egress) — tighter per-IP budget. */
const CONTENT_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 60,
  refillRate: 60,
  refillIntervalMs: 60_000,
}

/**
 * Per-IP rate limit for the unauthenticated public share endpoints, returning a
 * `429` response when exceeded (or `null` to proceed). The token is unguessable,
 * so this defends a *known* link against hammering (DoS / S3 egress) rather than
 * enumeration. Fails open on storage errors (availability over strictness),
 * matching the chat public route.
 */
export async function enforcePublicFileRateLimit(
  request: { headers: { get(name: string): string | null } },
  scope: 'metadata' | 'content'
): Promise<NextResponse | null> {
  const ip = getClientIp(request)
  const config = scope === 'content' ? CONTENT_RATE_LIMIT : METADATA_RATE_LIMIT
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
