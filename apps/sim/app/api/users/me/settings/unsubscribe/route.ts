import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { unsubscribeBodySchema, unsubscribeQuerySchema } from '@/lib/api/contracts/user'
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

export const GET = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(req.url)
    const parsedQuery = unsubscribeQuerySchema.safeParse({
      email: searchParams.get('email') || undefined,
      token: searchParams.get('token') || undefined,
    })

    if (!parsedQuery.success) {
      logger.warn(`[${requestId}] Missing email or token in GET request`)
      return NextResponse.json({ error: 'Missing email or token parameter' }, { status: 400 })
    }
    const { email, token } = parsedQuery.data

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

  try {
    const { searchParams } = new URL(req.url)
    const contentType = req.headers.get('content-type') || ''

    let email: string
    let token: string
    let type: 'all' | 'marketing' | 'updates' | 'notifications' = 'all'

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const parsedQuery = unsubscribeQuerySchema.safeParse({
        email: searchParams.get('email') || undefined,
        token: searchParams.get('token') || undefined,
      })

      if (!parsedQuery.success) {
        logger.warn(`[${requestId}] One-click unsubscribe missing email or token in URL`)
        return NextResponse.json({ error: 'Missing email or token parameter' }, { status: 400 })
      }

      email = parsedQuery.data.email
      token = parsedQuery.data.token

      logger.info(`[${requestId}] Processing one-click unsubscribe for: ${email}`)
    } else {
      const body = await req.json()
      const result = unsubscribeBodySchema.safeParse(body)

      if (!result.success) {
        logger.warn(`[${requestId}] Invalid unsubscribe POST data`, {
          errors: result.error.issues,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: result.error.issues },
          { status: 400 }
        )
      }

      email = result.data.email
      token = result.data.token
      type = result.data.type
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
