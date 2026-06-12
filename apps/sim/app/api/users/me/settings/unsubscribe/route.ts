import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  unsubscribeFormContract,
  unsubscribeGetContract,
  unsubscribePostContract,
} from '@/lib/api/contracts/user'
import { parseRequest } from '@/lib/api/server'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { EmailType } from '@/lib/messaging/email/mailer'
import {
  getEmailPreferences,
  isTransactionalEmail,
  unsubscribeFromAll,
  updateEmailPreferences,
  verifyUnsubscribeToken,
} from '@/lib/messaging/email/unsubscribe'

const logger = createLogger('UnsubscribeAPI')

const UNSUBSCRIBE_RATE_LIMIT = {
  maxTokens: 10,
  refillRate: 10,
  refillIntervalMs: 60_000,
}

export const GET = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  const rateLimited = await enforceIpRateLimit('unsubscribe', req, UNSUBSCRIBE_RATE_LIMIT)
  if (rateLimited) return rateLimited

  try {
    const parsed = await parseRequest(
      unsubscribeGetContract,
      req,
      {},
      {
        validationErrorResponse: () =>
          NextResponse.json({ error: 'Missing email or token parameter' }, { status: 400 }),
      }
    )
    if (!parsed.success) {
      logger.warn(`[${requestId}] Missing email or token in GET request`)
      return parsed.response
    }
    const { email, token } = parsed.data.query

    const tokenVerification = verifyUnsubscribeToken(email, token)
    if (!tokenVerification.valid) {
      logger.warn(`[${requestId}] Invalid unsubscribe token for email: ${email}`)
      return NextResponse.json({ error: 'Invalid or expired unsubscribe link' }, { status: 400 })
    }

    const emailType = tokenVerification.emailType as EmailType
    const isTransactional = isTransactionalEmail(emailType)

    const preferences = await getEmailPreferences(email)

    logger.info(
      `[${requestId}] Valid unsubscribe GET request for email: ${email}, type: ${emailType}`
    )

    return NextResponse.json({
      success: true,
      email,
      token,
      emailType,
      isTransactional,
      currentPreferences: preferences || {},
    })
  } catch (error) {
    logger.error(`[${requestId}] Error processing unsubscribe GET request:`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  const rateLimited = await enforceIpRateLimit('unsubscribe', req, UNSUBSCRIBE_RATE_LIMIT)
  if (rateLimited) return rateLimited

  try {
    const contentType = req.headers.get('content-type') || ''

    let email: string
    let token: string
    let type: 'all' | 'marketing' | 'updates' | 'notifications' = 'all'

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const parsed = await parseRequest(
        unsubscribeFormContract,
        req,
        {},
        {
          validationErrorResponse: () =>
            NextResponse.json({ error: 'Missing email or token parameter' }, { status: 400 }),
        }
      )
      if (!parsed.success) {
        logger.warn(`[${requestId}] One-click unsubscribe missing email or token in URL`)
        return parsed.response
      }

      email = parsed.data.query.email
      token = parsed.data.query.token

      logger.info(`[${requestId}] Processing one-click unsubscribe for: ${email}`)
    } else {
      const parsed = await parseRequest(
        unsubscribePostContract,
        req,
        {},
        {
          validationErrorResponse: (error) =>
            NextResponse.json(
              { error: 'Invalid request data', details: error.issues },
              { status: 400 }
            ),
        }
      )
      if (!parsed.success) {
        logger.warn(`[${requestId}] Invalid unsubscribe POST data`)
        return parsed.response
      }

      email = parsed.data.body.email
      token = parsed.data.body.token
      type = parsed.data.body.type
    }

    const tokenVerification = verifyUnsubscribeToken(email, token)
    if (!tokenVerification.valid) {
      logger.warn(`[${requestId}] Invalid unsubscribe token for email: ${email}`)
      return NextResponse.json({ error: 'Invalid or expired unsubscribe link' }, { status: 400 })
    }

    const emailType = tokenVerification.emailType as EmailType
    const isTransactional = isTransactionalEmail(emailType)

    if (isTransactional) {
      logger.warn(`[${requestId}] Attempted to unsubscribe from transactional email: ${email}`)
      return NextResponse.json(
        {
          error: 'Cannot unsubscribe from transactional emails',
          isTransactional: true,
          message:
            'Transactional emails cannot be unsubscribed from as they contain important account information.',
        },
        { status: 400 }
      )
    }

    let success = false
    switch (type) {
      case 'all':
        success = await unsubscribeFromAll(email)
        break
      case 'marketing':
        success = await updateEmailPreferences(email, { unsubscribeMarketing: true })
        break
      case 'updates':
        success = await updateEmailPreferences(email, { unsubscribeUpdates: true })
        break
      case 'notifications':
        success = await updateEmailPreferences(email, { unsubscribeNotifications: true })
        break
    }

    if (!success) {
      logger.error(`[${requestId}] Failed to update unsubscribe preferences for: ${email}`)
      return NextResponse.json({ error: 'Failed to process unsubscribe request' }, { status: 500 })
    }

    logger.info(`[${requestId}] Successfully unsubscribed ${email} from ${type}`)

    return NextResponse.json(
      {
        success: true,
        message: `Successfully unsubscribed from ${type} emails`,
        email,
        type,
        emailType,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error processing unsubscribe POST request:`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
