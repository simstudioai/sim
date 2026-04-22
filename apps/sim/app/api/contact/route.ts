import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { renderHelpConfirmationEmail } from '@/components/emails'
import { env } from '@/lib/core/config/env'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { isTurnstileConfigured, verifyTurnstileToken } from '@/lib/core/security/turnstile'
import { generateRequestId, getClientIp } from '@/lib/core/utils/request'
import { getEmailDomain, SITE_URL } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'
import {
  contactRequestSchema,
  getContactTopicLabel,
  mapContactTopicToHelpType,
} from '@/app/(landing)/components/contact/consts'

const logger = createLogger('ContactAPI')
const rateLimiter = new RateLimiter()
const SITE_HOSTNAME = new URL(SITE_URL).hostname

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
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((resetAt.getTime() - Date.now()) / 1000)) },
        }
      )
    }

    const body = (await req.json()) as Record<string, unknown>

    const honeypot = body?.website
    if (typeof honeypot === 'string' && honeypot.trim().length > 0) {
      logger.warn(`[${requestId}] Honeypot triggered, discarding`, { ip })
      return NextResponse.json(SUCCESS_RESPONSE, { status: 201 })
    }

    const captchaUnavailable = body?.captchaUnavailable === true

    if (captchaUnavailable) {
      const nocaptchaKey = `public:contact:nocaptcha:${ip}`
      const { allowed: nocaptchaAllowed } = await rateLimiter.checkRateLimitDirect(
        nocaptchaKey,
        CAPTCHA_UNAVAILABLE_RATE_LIMIT
      )
      if (!nocaptchaAllowed) {
        logger.warn(`[${requestId}] Rate limit exceeded (no-captcha) for IP ${ip}`)
        return NextResponse.json(
          { error: 'Too many requests. Please try again later.' },
          { status: 429 }
        )
      }
    }

    if (isTurnstileConfigured() && !captchaUnavailable) {
      const token = typeof body?.captchaToken === 'string' ? body.captchaToken : null
      const verification = await verifyTurnstileToken({
        token,
        remoteIp: ip,
        expectedHostname: SITE_HOSTNAME,
      })
      if (!verification.success && verification.transportError) {
        logger.warn(
          `[${requestId}] Captcha transport error, falling back to no-captcha rate limit`,
          { ip }
        )
        const nocaptchaKey = `public:contact:nocaptcha:${ip}`
        const { allowed: nocaptchaAllowed } = await rateLimiter.checkRateLimitDirect(
          nocaptchaKey,
          CAPTCHA_UNAVAILABLE_RATE_LIMIT
        )
        if (!nocaptchaAllowed) {
          logger.warn(`[${requestId}] Rate limit exceeded (transport-error fallback) for IP ${ip}`)
          return NextResponse.json(
            { error: 'Too many requests. Please try again later.' },
            { status: 429 }
          )
        }
      } else if (!verification.success) {
        logger.warn(`[${requestId}] Captcha verification failed`, {
          ip,
          errorCodes: verification.errorCodes,
        })
        return NextResponse.json(
          { error: 'Captcha verification failed. Please try again.' },
          { status: 400 }
        )
      }
    }

    const validationResult = contactRequestSchema.safeParse(body)

    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid contact request data`, {
        errors: validationResult.error.format(),
      })
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
    }

    const { name, email, company, topic, subject, message } = validationResult.data
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
