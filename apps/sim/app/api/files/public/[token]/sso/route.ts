import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { publicFileSSOContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { isEmailAllowed } from '@/lib/core/security/deployment'
import { generateRequestId, getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('PublicFileSSOAPI')

const rateLimiter = new RateLimiter()

const SSO_IP_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 20,
  refillRate: 20,
  refillIntervalMs: 15 * 60_000,
}

const SSO_RESOURCE_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 100,
  refillRate: 100,
  refillIntervalMs: 15 * 60_000,
}

function rateLimited(retryAfterMs: number | undefined, fallbackMs: number): NextResponse {
  const response = NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    { status: 429 }
  )
  response.headers.set('Retry-After', String(Math.ceil((retryAfterMs ?? fallbackMs) / 1000)))
  return response
}

/**
 * POST /api/files/public/[token]/sso
 * Reports whether an email is on the allow-list for an SSO-gated share. The actual
 * authentication is the global Sim session (checked at the page/route gate).
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const requestId = generateRequestId()

    const ip = getClientIp(request)
    if (ip) {
      const ipRateLimit = await rateLimiter.checkRateLimitDirect(
        `file-sso:ip:${ip}`,
        SSO_IP_RATE_LIMIT,
        { failClosed: true }
      )
      if (!ipRateLimit.allowed) {
        logger.warn(`[${requestId}] SSO eligibility rate limit exceeded from ${ip}`)
        return rateLimited(ipRateLimit.retryAfterMs, SSO_IP_RATE_LIMIT.refillIntervalMs)
      }
    }

    const parsed = await parseRequest(publicFileSSOContract, request, context)
    if (!parsed.success) return parsed.response
    const { token } = parsed.data.params
    const email = normalizeEmail(parsed.data.body.email)

    const resolved = await resolveActiveShareByToken(token)
    if (!resolved) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (resolved.share.authType !== 'sso') {
      return NextResponse.json({ error: 'This file is not configured for SSO' }, { status: 400 })
    }

    const resourceRateLimit = await rateLimiter.checkRateLimitDirect(
      `file-sso:resource:${resolved.share.id}`,
      SSO_RESOURCE_RATE_LIMIT,
      { failClosed: true }
    )
    if (!resourceRateLimit.allowed) {
      logger.warn(`[${requestId}] SSO eligibility resource rate limit exceeded`, {
        shareId: resolved.share.id,
      })
      return rateLimited(resourceRateLimit.retryAfterMs, SSO_RESOURCE_RATE_LIMIT.refillIntervalMs)
    }

    const allowedEmails = Array.isArray(resolved.share.allowedEmails)
      ? (resolved.share.allowedEmails as string[])
      : []
    return NextResponse.json({ eligible: isEmailAllowed(email, allowedEmails) })
  }
)
