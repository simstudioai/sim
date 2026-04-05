import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'
import {
  demoRequestSchema,
  getDemoRequestCompanySizeLabel,
} from '@/app/(landing)/components/demo-request/consts'

const logger = createLogger('DemoRequestAPI')
const rateLimiter = new RateLimiter()

const PUBLIC_ENDPOINT_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 5,
  refillIntervalMs: 60_000,
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const storageKey = `public:demo-request:${ip}`

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
    const validationResult = demoRequestSchema.safeParse(body)

    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid demo request data`, {
        errors: validationResult.error.format(),
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: validationResult.error.format() },
        { status: 400 }
      )
    }

    const { firstName, lastName, companyEmail, phoneNumber, companySize, details } =
      validationResult.data

    logger.info(`[${requestId}] Processing demo request`, {
      email: `${companyEmail.substring(0, 3)}***`,
      companySize,
    })

    const emailText = `Demo request submitted
Submitted: ${new Date().toISOString()}
Name: ${firstName} ${lastName}
Email: ${companyEmail}
Phone: ${phoneNumber ?? 'Not provided'}
Company size: ${getDemoRequestCompanySizeLabel(companySize)}

Details:
${details}
`

    const emailResult = await sendEmail({
      to: [`enterprise@${env.EMAIL_DOMAIN || getEmailDomain()}`],
      subject: `[DEMO REQUEST] ${firstName} ${lastName}`,
      text: emailText,
      from: getFromEmailAddress(),
      replyTo: companyEmail,
      emailType: 'transactional',
    })

    if (!emailResult.success) {
      logger.error(`[${requestId}] Error sending demo request email`, emailResult.message)
      return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 })
    }

    logger.info(`[${requestId}] Demo request email sent successfully`)

    return NextResponse.json(
      { success: true, message: 'Thanks! Our team will reach out shortly.' },
      { status: 201 }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error processing demo request`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
