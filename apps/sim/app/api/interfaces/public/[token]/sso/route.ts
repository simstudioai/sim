import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { publicInterfaceSSOContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { isEmailAllowed } from '@/lib/core/security/deployment'
import { generateRequestId, getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveActiveInterfaceShareByToken } from '@/lib/public-shares/share-manager'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('PublicInterfaceSSOAPI')

const rateLimiter = new RateLimiter()

const SSO_IP_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 20,
  refillRate: 20,
  refillIntervalMs: 15 * 60_000,
}

/**
 * POST /api/interfaces/public/[token]/sso
 * Reports whether an email is on the allow-list for an SSO-gated interface
 * share. The actual authentication is the global Sim session (checked at the
 * page/route gate) — this endpoint never mints a share auth cookie.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const requestId = generateRequestId()

    const ip = getClientIp(request)
    const ipRateLimit = await rateLimiter.checkRateLimitDirect(
      `interface-sso:ip:${ip}`,
      SSO_IP_RATE_LIMIT
    )
    if (!ipRateLimit.allowed) {
      logger.warn(`[${requestId}] SSO eligibility rate limit exceeded from ${ip}`)
      const response = NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
      response.headers.set(
        'Retry-After',
        String(Math.ceil((ipRateLimit.retryAfterMs ?? SSO_IP_RATE_LIMIT.refillIntervalMs) / 1000))
      )
      return response
    }

    const parsed = await parseRequest(publicInterfaceSSOContract, request, context)
    if (!parsed.success) return parsed.response
    const { token } = parsed.data.params
    const email = normalizeEmail(parsed.data.body.email)

    const resolved = await resolveActiveInterfaceShareByToken(token)
    if (!resolved) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (resolved.share.authType !== 'sso') {
      return NextResponse.json(
        { error: 'This interface is not configured for SSO' },
        { status: 400 }
      )
    }

    const allowedEmails = Array.isArray(resolved.share.allowedEmails)
      ? (resolved.share.allowedEmails as string[])
      : []
    return NextResponse.json({ eligible: isEmailAllowed(email, allowedEmails) })
  }
)
