import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { generateRequestId, getClientIp } from '@/lib/core/utils/request'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import {
  getFromEmailAddress,
  NO_EMAIL_HEADER_CONTROL_CHARS_REGEX,
} from '@/lib/messaging/email/utils'

const logger = createLogger('IntegrationRequestAPI')

const rateLimiter = new RateLimiter()

const PUBLIC_ENDPOINT_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 5,
  refillIntervalMs: 60_000,
}

const integrationRequestSchema = z.object({
  integrationName: z
    .string()
    .trim()
    .min(1, 'Integration name is required')
    .max(200)
    .regex(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX, 'Invalid characters'),
  email: z.string().email('A valid email is required'),
  useCase: z.string().max(2000).optional(),
})

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const ip = getClientIp(req)
    const storageKey = `public:integration-request:${ip}`

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

    const validationResult = integrationRequestSchema.safeParse(body)
    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid integration request data`, {
        errors: validationResult.error.format(),
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: validationResult.error.format() },
        { status: 400 }
      )
    }

    const { integrationName, email, useCase } = validationResult.data

    logger.info(`[${requestId}] Processing integration request`, {
      integrationName,
      email: `${email.substring(0, 3)}***`,
    })

    const emailText = `Integration: ${integrationName}
From: ${email}
Submitted: ${new Date().toISOString()}

${useCase ? `Use Case:\n${useCase}` : 'No use case provided.'}
`

    const emailResult = await sendEmail({
      to: [`help@${env.EMAIL_DOMAIN || getEmailDomain()}`],
      subject: `[INTEGRATION REQUEST] ${integrationName}`,
      text: emailText,
      from: getFromEmailAddress(),
      replyTo: email,
      emailType: 'transactional',
    })

    if (!emailResult.success) {
      logger.error(`[${requestId}] Error sending integration request email`, emailResult.message)
      return NextResponse.json({ error: 'Failed to send request' }, { status: 500 })
    }

    logger.info(`[${requestId}] Integration request email sent successfully`)

    return NextResponse.json(
      { success: true, message: 'Integration request submitted successfully' },
      { status: 200 }
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('not configured')) {
      logger.error(`[${requestId}] Email service configuration error`, error)
      return NextResponse.json(
        { error: 'Email service is temporarily unavailable. Please try again later.' },
        { status: 500 }
      )
    }

    logger.error(`[${requestId}] Error processing integration request`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
