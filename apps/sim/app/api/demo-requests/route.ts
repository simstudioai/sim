import { createLogger } from '@sim/logger'
import { after, type NextRequest, NextResponse } from 'next/server'
import { formatAttributionForNotification } from '@/lib/analytics/attribution'
import {
  getDemoRequestCompanySizeLabel,
  submitDemoRequestContract,
} from '@/lib/api/contracts/demo-requests'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { isTurnstileConfigured, verifyTurnstileToken } from '@/lib/core/security/turnstile'
import { getClientIp } from '@/lib/core/utils/request'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { type DemoBookerStatus, recordDemoBooker } from '@/lib/demo-booking/bookers'
import { notifyDemoRequest } from '@/lib/demo-booking/notify'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'

const logger = createLogger('DemoRequestAPI')
const rateLimiter = new RateLimiter()

const PUBLIC_ENDPOINT_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 5,
  refillIntervalMs: 60_000,
}

const CAPTCHA_UNAVAILABLE_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 3,
  refillRate: 1,
  refillIntervalMs: 60_000,
}

const SUCCESS_RESPONSE = { success: true, message: 'Thanks! Our team will reach out shortly.' }
const TOO_MANY_REQUESTS_RESPONSE = { error: 'Too many requests. Please try again later.' }

/**
 * Public demo-form endpoint: per-IP rate limit, honeypot drop, captcha, then a
 * record of how far the form vouched for the visitor's email, which decides
 * their Cal.com booking (see {@link recordDemoBooker} and
 * `lib/demo-booking/review.ts`). The form opens the calendar only after this
 * answers, so a booking can never outrun its record; a failed write answers 503
 * and the visitor retries instead of booking unrecorded. The sales email and the
 * sales-channel event ({@link notifyDemoRequest}) go out after the response.
 *
 * The captcha mirrors `/api/contact`: a valid Turnstile token marks the email
 * `verified`; a missing token or a Cloudflare transport error passes through the
 * stricter no-captcha bucket and marks it `unverified`, so a person whose
 * widget was blocked still books, pending a manual review; an invalid token is
 * rejected. A tripped honeypot answers as a success and records nothing, so the
 * bot's booking is declined.
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  try {
    const ip = getClientIp(req)
    if (!ip) {
      logger.warn('Unable to resolve client IP for public rate limit')
      return NextResponse.json(TOO_MANY_REQUESTS_RESPONSE, { status: 429 })
    }
    const storageKey = `public:demo-request:${ip}`
    const { allowed, remaining, resetAt } = await rateLimiter.checkRateLimitDirect(
      storageKey,
      PUBLIC_ENDPOINT_RATE_LIMIT
    )

    if (!allowed) {
      logger.warn('Rate limit exceeded', { ip, remaining, resetAt })
      return NextResponse.json(TOO_MANY_REQUESTS_RESPONSE, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((resetAt.getTime() - Date.now()) / 1000)) },
      })
    }

    const parsed = await parseRequest(submitDemoRequestContract, req, {})
    if (!parsed.success) {
      logger.warn('Invalid demo request data')
      return parsed.response
    }

    const {
      firstName,
      lastName,
      companyEmail,
      phoneNumber,
      companySize,
      details,
      website,
      captchaToken,
    } = parsed.data.body

    if (website && website.trim().length > 0) {
      logger.warn('Honeypot triggered, discarding', { ip })
      return NextResponse.json(SUCCESS_RESPONSE, { status: 201 })
    }

    let bookerStatus: DemoBookerStatus = 'unverified'
    if (isTurnstileConfigured()) {
      const token = captchaToken && captchaToken.length > 0 ? captchaToken : null
      if (token) {
        const verification = await verifyTurnstileToken({ token, remoteIp: ip })
        if (verification.success) {
          bookerStatus = 'verified'
        } else if (!verification.transportError) {
          logger.warn('Captcha verification failed', { ip, errorCodes: verification.errorCodes })
          return NextResponse.json(
            { error: 'Captcha verification failed. Please try again.' },
            { status: 400 }
          )
        }
      }

      if (bookerStatus !== 'verified') {
        const { allowed: nocaptchaAllowed } = await rateLimiter.checkRateLimitDirect(
          `public:demo-request:nocaptcha:${ip}`,
          CAPTCHA_UNAVAILABLE_RATE_LIMIT,
          { failClosed: true }
        )
        if (!nocaptchaAllowed) {
          logger.warn('Rate limit rejected (no-captcha)', { ip })
          return NextResponse.json(TOO_MANY_REQUESTS_RESPONSE, { status: 429 })
        }
      }
    }

    try {
      await recordDemoBooker(companyEmail, bookerStatus)
    } catch (error) {
      logger.error('Could not record the demo booker', { error })
      return NextResponse.json(
        { error: 'We could not save your request. Please try again.' },
        { status: 503 }
      )
    }

    const attribution = formatAttributionForNotification((name) => req.cookies.get(name)?.value)

    logger.info('Processing demo request', {
      email: `${companyEmail.substring(0, 3)}***`,
      companySize,
    })

    const submittedAt = new Date().toISOString()
    const emailText = `Demo request submitted
Submitted: ${submittedAt}
Name: ${firstName} ${lastName}
Email: ${companyEmail}
Phone: ${phoneNumber ?? 'Not provided'}
Company size: ${getDemoRequestCompanySizeLabel(companySize)}

Details:
${details}
${attribution ? `\nAttribution:\n${attribution}\n` : ''}`

    // The visitor waits on this response before the calendar opens; the sales
    // notification does not need to hold it up.
    after(async () => {
      const emailResult = await sendEmail({
        to: [`enterprise@${env.EMAIL_DOMAIN || getEmailDomain()}`],
        subject: `[DEMO REQUEST] ${firstName} ${lastName}`,
        text: emailText,
        from: getFromEmailAddress(),
        replyTo: companyEmail,
        emailType: 'transactional',
      })
      if (emailResult.success) logger.info('Demo request email sent successfully')
      else logger.error('Error sending demo request email', emailResult.message)
    })
    after(() =>
      notifyDemoRequest({
        type: 'demo_request.submitted',
        email: companyEmail,
        name: `${firstName} ${lastName}`,
        phone: phoneNumber ?? null,
        companySize: getDemoRequestCompanySizeLabel(companySize),
        details,
        attribution: attribution || null,
        verification: bookerStatus,
        submittedAt,
      })
    )

    return NextResponse.json(SUCCESS_RESPONSE, { status: 201 })
  } catch (error) {
    logger.error('Error processing demo request', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
