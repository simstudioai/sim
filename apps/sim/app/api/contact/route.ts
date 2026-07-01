import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { renderHelpConfirmationEmail } from '@/components/emails'
import {
  getContactTopicLabel,
  mapContactTopicToHelpType,
  submitContactContract,
} from '@/lib/api/contracts/contact'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { isTurnstileConfigured, verifyTurnstileToken } from '@/lib/core/security/turnstile'
import { generateRequestId, getClientIp } from '@/lib/core/utils/request'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'

const logger = createLogger('ContactAPI')
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

const SUCCESS_RESPONSE = { success: true, message: "Thanks — we'll be in touch soon." }
const TOO_MANY_REQUESTS_RESPONSE = { error: 'Too many requests. Please try again later.' }

export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const ip = getClientIp(req)
    const storageKey = `public:contact:${ip}`

    const { allowed, remaining, resetAt } = await rateLimiter.checkRateLimitDirect(
      storageKey,
      PUBLIC_ENDPOINT_RATE_LIMIT
    )

    if (!allowed) {
      logger.warn(`[${requestId}] Rate limit exceeded for IP ${ip}`, { remaining, resetAt })
      return NextResponse.json(TOO_MANY_REQUESTS_RESPONSE, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((resetAt.getTime() - Date.now()) / 1000)) },
      })
    }

    const parsed = await parseRequest(submitContactContract, req, {})
    if (!parsed.success) {
      logger.warn(`[${requestId}] Invalid contact request data`)
      return parsed.response
    }

    const { name, email, company, topic, subject, message, website, captchaToken } =
      parsed.data.body

    if (typeof website === 'string' && website.trim().length > 0) {
      logger.warn(`[${requestId}] Honeypot triggered, discarding`, { ip })
      return NextResponse.json(SUCCESS_RESPONSE, { status: 201 })
    }

    // Captcha is server-authoritative: a valid Turnstile token is the only way to
    // skip the stricter fallback bucket. A missing token (widget could not load) or
    // a Cloudflare transport error falls back to the tighter no-captcha rate limit
    // rather than a free pass, so callers cannot opt out of the challenge. An
    // outright invalid token is rejected.
    if (isTurnstileConfigured()) {
      let captchaVerified = false
      const token =
        typeof captchaToken === 'string' && captchaToken.length > 0 ? captchaToken : null

      if (token) {
        // No expectedHostname: the Turnstile site key is already domain-bound in
        // Cloudflare, and pinning a single hostname here would reject valid tokens
        // from self-hosted, preview, and apex-vs-www deployments.
        const verification = await verifyTurnstileToken({ token, remoteIp: ip })
        if (verification.success) {
          captchaVerified = true
        } else if (!verification.transportError) {
          logger.warn(`[${requestId}] Captcha verification failed`, {
            ip,
            errorCodes: verification.errorCodes,
          })
          return NextResponse.json(
            { error: 'Captcha verification failed. Please try again.' },
            { status: 400 }
          )
        } else {
          logger.warn(
            `[${requestId}] Captcha transport error, falling back to no-captcha rate limit`,
            { ip }
          )
        }
      }

      if (!captchaVerified) {
        // Fail closed: this bucket is the only throttle on token-less submits, so
        // if the limiter storage is unavailable we reject rather than admit an
        // uncaptcha'd request to the email path.
        const nocaptchaKey = `public:contact:nocaptcha:${ip}`
        const { allowed: nocaptchaAllowed } = await rateLimiter.checkRateLimitDirect(
          nocaptchaKey,
          CAPTCHA_UNAVAILABLE_RATE_LIMIT,
          { failClosed: true }
        )
        if (!nocaptchaAllowed) {
          logger.warn(`[${requestId}] Rate limit rejected (no-captcha) for IP ${ip}`)
          return NextResponse.json(TOO_MANY_REQUESTS_RESPONSE, { status: 429 })
        }
      }
    }

    const topicLabel = getContactTopicLabel(topic)

    logger.info(`[${requestId}] Processing contact request`, {
      email: `${email.substring(0, 3)}***`,
      topic,
    })

    const emailText = `Contact form submission
Submitted: ${new Date().toISOString()}
Topic: ${topicLabel}
Name: ${name}
Email: ${email}
Company: ${company ?? 'Not provided'}

Subject: ${subject}

Message:
${message}
`

    const helpInboxDomain = env.EMAIL_DOMAIN || getEmailDomain()
    const emailResult = await sendEmail({
      to: [`help@${helpInboxDomain}`],
      subject: `[CONTACT:${topic.toUpperCase()}] ${subject}`,
      text: emailText,
      from: getFromEmailAddress(),
      replyTo: email,
      emailType: 'transactional',
    })

    if (!emailResult.success) {
      logger.error(`[${requestId}] Error sending contact request email`, emailResult.message)
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    }

    logger.info(`[${requestId}] Contact request email sent successfully`)

    try {
      const confirmationHtml = await renderHelpConfirmationEmail(
        mapContactTopicToHelpType(topic),
        0
      )

      await sendEmail({
        to: [email],
        subject: `We've received your message: ${subject}`,
        html: confirmationHtml,
        from: getFromEmailAddress(),
        replyTo: `help@${helpInboxDomain}`,
        emailType: 'transactional',
      })
    } catch (err) {
      logger.warn(`[${requestId}] Failed to send contact confirmation email`, err)
    }

    return NextResponse.json(SUCCESS_RESPONSE, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not configured')) {
      logger.error(`[${requestId}] Email service configuration error`, error)
      return NextResponse.json({ error: 'Email service configuration error.' }, { status: 500 })
    }

    logger.error(`[${requestId}] Error processing contact request`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
