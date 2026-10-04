import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  requestPublicFileOtpContract,
  verifyPublicFileOtpContract,
} from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { OTP_IP_RATE_LIMIT } from '@/lib/core/security/otp'
import { afterResponse } from '@/lib/core/utils/after-response'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { publicFileAuthDenied, publicFileErrorResponse } from '@/lib/public-shares/api'
import {
  requestPublicFileShareOtp,
  verifyPublicFileShareOtp,
} from '@/lib/public-shares/application'

export const dynamic = 'force-dynamic'
const logger = createLogger('PublicFileOtpAPI')
const rateLimiter = new RateLimiter()

/** Accepted email requests retain one response; the application delivers only to authorized recipients. */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    try {
      const ip = getClientIp(request)
      if (ip) {
        const limited = await rateLimiter.checkRateLimitDirect(
          `file-otp:ip:${ip}`,
          OTP_IP_RATE_LIMIT,
          { failClosed: true }
        )
        if (!limited.allowed)
          return publicFileAuthDenied({
            error: 'Too many requests. Please try again later.',
            status: 429,
            retryAfterMs: limited.retryAfterMs ?? OTP_IP_RATE_LIMIT.refillIntervalMs,
          })
      }
      const parsed = await parseRequest(requestPublicFileOtpContract, request, context)
      if (!parsed.success) return parsed.response
      const accepted = await requestPublicFileShareOtp({
        token: parsed.data.params.token,
        email: parsed.data.body.email,
      })
      afterResponse(accepted.deliver)
      return NextResponse.json({ message: 'Verification code sent' })
    } catch (error) {
      logger.error('Error processing OTP request:', error)
      return publicFileErrorResponse(error, 'Failed to process request')
    }
  }
)

/** The application consumes a correct OTP and returns the current resource-policy cookie. */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    try {
      const parsed = await parseRequest(verifyPublicFileOtpContract, request, context)
      if (!parsed.success) return parsed.response
      const auth = await verifyPublicFileShareOtp({
        token: parsed.data.params.token,
        ...parsed.data.body,
      })
      if (!auth.authorized) return publicFileAuthDenied(auth)
      const response = NextResponse.json({ authType: auth.authType })
      response.cookies.set(auth.cookie)
      return response
    } catch (error) {
      logger.error('Error verifying OTP:', error)
      return publicFileErrorResponse(error, 'Failed to process request')
    }
  }
)
