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
 * Runs cost real money (LLM tokens, tool calls) on the workspace's billing
 * account, so an anonymous visitor gets the tightest per-IP budget of all.
 */
const EXECUTE_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 10,
  refillIntervalMs: 60_000,
}

/**
 * Aggregate ceiling for one share across every visitor. The per-IP bucket alone
 * does not bound a link that is passed around, and the per-actor plan limit is
 * shared by every anonymous visitor of the workspace — so a hot link could
 * otherwise drain the whole plan quota. Applied in addition to the per-IP
 * bucket, never instead of it, on every scope that costs the workspace money
 * (`content` S3 egress, `execute` LLM tokens). `metadata` is a single indexed
 * lookup that spends nothing, so it stays per-IP only — an aggregate ceiling
 * tighter than its own per-IP budget would throttle a merely popular link for
 * no benefit.
 */
const PER_SHARE_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 60,
  refillRate: 60,
  refillIntervalMs: 60_000,
}

export type PublicShareRateScope = 'metadata' | 'content' | 'execute'

const SCOPE_RATE_LIMITS: Record<PublicShareRateScope, TokenBucketConfig> = {
  metadata: METADATA_RATE_LIMIT,
  content: CONTENT_RATE_LIMIT,
  execute: EXECUTE_RATE_LIMIT,
}

function tooManyRequests(retryAfterMs: number | undefined): NextResponse {
  const headers =
    retryAfterMs != null ? { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } : undefined
  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    { status: 429, headers }
  )
}

/**
 * Consumes one token from the caller's per-IP bucket for `scope`, returning a
 * `429` response when exceeded (or `null` to proceed).
 *
 * Call this once, first — before the token is parsed or resolved — so an
 * unresolved token cannot hammer the database. The token is unguessable, so this
 * defends a *known* link against hammering (DoS / S3 egress) rather than
 * enumeration; it bounds one visitor, not the link.
 *
 * Fails open on storage errors (availability over strictness), matching the
 * chat public route.
 */
export async function enforcePerIpRateLimit(
  request: { headers: { get(name: string): string | null } },
  scope: PublicShareRateScope
): Promise<NextResponse | null> {
  const ip = getClientIp(request)
  const result = await rateLimiter.checkRateLimitDirect(
    `public-share:${scope}:${ip}`,
    SCOPE_RATE_LIMITS[scope]
  )
  return result.allowed ? null : tooManyRequests(result.retryAfterMs)
}

/**
 * Consumes one token from the share's aggregate bucket, returning a `429`
 * response when exceeded (or `null` to proceed) — see
 * {@link PER_SHARE_RATE_LIMIT}.
 *
 * The share id is only known once the token resolves, so this runs after
 * resolution *and* after the share's auth gate: charging it earlier would let a
 * caller who holds the token but fails the gate drain the ceiling for everyone
 * else. Every cost-bearing scope (`content`, `execute`) must call this in
 * addition to {@link enforcePerIpRateLimit}.
 *
 * It is a separate function from {@link enforcePerIpRateLimit}, rather than an
 * optional `shareId` on one combined call, because each token bucket read is a
 * *consume*, not a peek: a combined helper had to be invoked twice per request
 * (once before resolution, once after) and so silently debited the per-IP bucket
 * twice, halving its effective limit. Split, each function charges exactly one
 * bucket exactly once and the call site names which one.
 *
 * Fails open on storage errors, like {@link enforcePerIpRateLimit}.
 */
export async function enforcePerShareRateLimit(
  scope: PublicShareRateScope,
  shareId: string
): Promise<NextResponse | null> {
  const result = await rateLimiter.checkRateLimitDirect(
    `public-share:${scope}:share:${shareId}`,
    PER_SHARE_RATE_LIMIT
  )
  return result.allowed ? null : tooManyRequests(result.retryAfterMs)
}
