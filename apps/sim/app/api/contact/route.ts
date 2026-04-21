import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { renderHelpConfirmationEmail } from '@/components/emails'
import { env } from '@/lib/core/config/env'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { generateRequestId, getClientIp } from '@/lib/core/utils/request'
import { getEmailDomain } from '@/lib/core/utils/urls'
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

const PUBLIC_ENDPOINT_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 5,
  refillIntervalMs: 60_000,
}

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

    const body = await req.json()
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

    return NextResponse.json(
      { success: true, message: "Thanks — we'll be in touch soon." },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('not configured')) {
      logger.error(`[${requestId}] Email service configuration error`, error)
      return NextResponse.json({ error: 'Email service configuration error.' }, { status: 500 })
    }

    logger.error(`[${requestId}] Error processing contact request`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
