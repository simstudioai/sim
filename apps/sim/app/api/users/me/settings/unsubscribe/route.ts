import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { EmailType } from '@/lib/messaging/email/mailer'
import {
  getEmailPreferences,
  isTransactionalEmail,
  unsubscribeFromAll,
  updateEmailPreferences,
  verifyUnsubscribeToken,
} from '@/lib/messaging/email/unsubscribe'

const logger = createLogger('UnsubscribeAPI')

const unsubscribeSchema = z.object({
  email: z.string().email('Invalid email address'),
  token: z.string().min(1, 'Token is required'),
  type: z.enum(['all', 'marketing', 'updates', 'notifications']).optional().default('all'),
})

export async function GET(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(req.url)
    const email = searchParams.get('email')
    const token = searchParams.get('token')

    if (!email || !token) {
      logger.warn(`[${requestId}] Missing email or token in GET request`)
      return NextResponse.json({ error: 'Missing email or token parameter' }, { status: 400 })
    }

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
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(req.url)
    const contentType = req.headers.get('content-type') || ''

    let email: string
    let token: string
    let type: 'all' | 'marketing' | 'updates' | 'notifications' = 'all'

    if (contentType.includes('application/x-www-form-urlencoded')) {
      email = searchParams.get('email') || ''
      token = searchParams.get('token') || ''

      if (!email || !token) {
        logger.warn(`[${requestId}] One-click unsubscribe missing email or token in URL`)
        return NextResponse.json({ error: 'Missing email or token parameter' }, { status: 400 })
      }

      logger.info(`[${requestId}] Processing one-click unsubscribe for: ${email}`)
    } else {
      const body = await req.json()
      const result = unsubscribeSchema.safeParse(body)

      if (!result.success) {
        logger.warn(`[${requestId}] Invalid unsubscribe POST data`, {
          errors: result.error.format(),
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: result.error.format() },
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
}
