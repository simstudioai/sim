import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { renderOTPEmail } from '@/components/emails'
import {
  requestPublicFileOtpContract,
  verifyPublicFileOtpContract,
} from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { isEmailAllowed, setDeploymentAuthCookie } from '@/lib/core/security/deployment'
import {
  decodeOTPValue,
  deleteOTP,
  generateOTP,
  getOTP,
  incrementOTPAttempts,
  MAX_OTP_ATTEMPTS,
  OTP_EMAIL_RATE_LIMIT,
  OTP_IP_RATE_LIMIT,
  storeOTP,
} from '@/lib/core/security/otp'
import { generateRequestId, getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'

export const dynamic = 'force-dynamic'

const logger = createLogger('PublicFileOtpAPI')

const rateLimiter = new RateLimiter()

const SHARE_EMAIL_LABEL = 'a shared file'

/** Allow-list for an email-gated share, read off the resolved row. */
function shareAllowedEmails(allowedEmails: unknown): string[] {
  return Array.isArray(allowedEmails) ? (allowedEmails as string[]) : []
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
 * POST /api/files/public/[token]/otp
 * Sends a 6-digit verification code to an allow-listed email for an email-gated share.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const requestId = generateRequestId()

    try {
      const ip = getClientIp(request)
      const ipRateLimit = await rateLimiter.checkRateLimitDirect(
        `file-otp:ip:${ip}`,
        OTP_IP_RATE_LIMIT
      )
      if (!ipRateLimit.allowed) {
        logger.warn(`[${requestId}] OTP IP rate limit exceeded from ${ip}`)
        return rateLimited(ipRateLimit.retryAfterMs, OTP_IP_RATE_LIMIT.refillIntervalMs)
      }

      const parsed = await parseRequest(requestPublicFileOtpContract, request, context)
      if (!parsed.success) return parsed.response
      const { token } = parsed.data.params
      // Normalize once so allow-list matching, OTP storage, and the verify lookup
      // all key off the same value (allow-list entries are stored lowercase).
      const email = parsed.data.body.email.trim().toLowerCase()

      const resolved = await resolveActiveShareByToken(token)
      if (!resolved) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (resolved.share.authType !== 'email') {
        return NextResponse.json(
          { error: 'This file does not use email authentication' },
          { status: 400 }
        )
      }

      if (!isEmailAllowed(email, shareAllowedEmails(resolved.share.allowedEmails))) {
        return NextResponse.json({ error: 'Email not authorized for this file' }, { status: 403 })
      }

      const emailRateLimit = await rateLimiter.checkRateLimitDirect(
        `file-otp:email:${resolved.share.id}:${email}`,
        OTP_EMAIL_RATE_LIMIT
      )
      if (!emailRateLimit.allowed) {
        logger.warn(`[${requestId}] OTP email rate limit exceeded for ${email}`)
        return rateLimited(emailRateLimit.retryAfterMs, OTP_EMAIL_RATE_LIMIT.refillIntervalMs)
      }

      const otp = generateOTP()
      await storeOTP('file', resolved.share.id, email, otp)

      const emailHtml = await renderOTPEmail(otp, email, 'email-verification', SHARE_EMAIL_LABEL)
      const emailResult = await sendEmail({
        to: email,
        subject: `Verification code for ${SHARE_EMAIL_LABEL}`,
        html: emailHtml,
      })
      if (!emailResult.success) {
        logger.error(`[${requestId}] Failed to send OTP email:`, emailResult.message)
        return NextResponse.json({ error: 'Failed to send verification email' }, { status: 500 })
      }

      logger.info(`[${requestId}] OTP sent for share ${resolved.share.id}`)
      return NextResponse.json({ message: 'Verification code sent' })
    } catch (error) {
      logger.error(`[${requestId}] Error processing OTP request:`, error)
      return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
    }
  }
)

/**
 * PUT /api/files/public/[token]/otp
 * Verifies the code and, on success, sets the `file_auth_{shareId}` cookie.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const requestId = generateRequestId()

    try {
      const parsed = await parseRequest(verifyPublicFileOtpContract, request, context)
      if (!parsed.success) return parsed.response
      const { token } = parsed.data.params
      const { otp } = parsed.data.body
      const email = parsed.data.body.email.trim().toLowerCase()

      const resolved = await resolveActiveShareByToken(token)
      if (!resolved) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (resolved.share.authType !== 'email') {
        return NextResponse.json(
          { error: 'This file does not use email authentication' },
          { status: 400 }
        )
      }

      const storedValue = await getOTP('file', resolved.share.id, email)
      if (!storedValue) {
        return NextResponse.json(
          { error: 'No verification code found, request a new one' },
          { status: 400 }
        )
      }

      const { otp: storedOTP, attempts } = decodeOTPValue(storedValue)
      if (attempts >= MAX_OTP_ATTEMPTS) {
        await deleteOTP('file', resolved.share.id, email)
        return NextResponse.json(
          { error: 'Too many failed attempts. Please request a new code.' },
          { status: 429 }
        )
      }

      if (storedOTP !== otp) {
        const result = await incrementOTPAttempts('file', resolved.share.id, email, storedValue)
        if (result === 'locked') {
          return NextResponse.json(
            { error: 'Too many failed attempts. Please request a new code.' },
            { status: 429 }
          )
        }
        return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 })
      }

      await deleteOTP('file', resolved.share.id, email)

      const response = NextResponse.json({ authType: resolved.share.authType })
      setDeploymentAuthCookie(
        response,
        'file',
        resolved.share.id,
        resolved.share.authType,
        resolved.share.password
      )
      logger.info(`[${requestId}] OTP verified for share ${resolved.share.id}`)
      return response
    } catch (error) {
      logger.error(`[${requestId}] Error verifying OTP:`, error)
      return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
    }
  }
)
