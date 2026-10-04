import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { publicFileSSOContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { RateLimiter, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { publicFileAuthDenied, publicFileErrorResponse } from '@/lib/public-shares/api'
import { getPublicFileShareSsoEligibility } from '@/lib/public-shares/application'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const logger = createLogger('PublicFileSSOAPI')
const rateLimiter = new RateLimiter()
const SSO_IP_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 20,
  refillRate: 20,
  refillIntervalMs: 15 * 60_000,
}

/** Eligibility preserves the existing SSO redirect flow and never grants file access by itself. */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    try {
      const ip = getClientIp(request)
      if (ip) {
        const limited = await rateLimiter.checkRateLimitDirect(
          `file-sso:ip:${ip}`,
          SSO_IP_RATE_LIMIT,
          { failClosed: true }
        )
        if (!limited.allowed)
          return publicFileAuthDenied({
            error: 'Too many requests. Please try again later.',
            status: 429,
            retryAfterMs: limited.retryAfterMs ?? SSO_IP_RATE_LIMIT.refillIntervalMs,
          })
      }
      const parsed = await parseRequest(publicFileSSOContract, request, context)
      if (!parsed.success) return parsed.response
      const result = await getPublicFileShareSsoEligibility({
        token: parsed.data.params.token,
        email: parsed.data.body.email,
      })
      return result.allowed
        ? NextResponse.json({ eligible: result.eligible })
        : publicFileAuthDenied(result)
    } catch (error) {
      logger.error('Error checking public file SSO eligibility:', error)
      return publicFileErrorResponse(error, 'Failed to process request')
    }
  }
)
