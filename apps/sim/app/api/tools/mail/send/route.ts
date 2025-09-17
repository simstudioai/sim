import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { type EmailOptions, sendEmail } from '@/lib/email/mailer'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MailSendAPI')

const MailSendSchema = z.object({
  to: z.string().email('Invalid email address').min(1, 'To email is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized mail send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          message: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated mail request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = MailSendSchema.parse(body)

    const fromAddress = env.MAIL_BLOCK_FROM_ADDRESS || env.FROM_EMAIL_ADDRESS

    if (!fromAddress) {
      logger.error(`[${requestId}] Email sending failed: No from address configured`)
      return NextResponse.json(
        {
          success: false,
          message: 'Email sending failed: No from address configured.',
        },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Sending email via internal mail API`, {
      to: validatedData.to,
      subject: validatedData.subject,
      bodyLength: validatedData.body.length,
      from: fromAddress,
    })

    const emailOptions: EmailOptions = {
      to: validatedData.to,
      subject: validatedData.subject,
      html: validatedData.body,
      text: validatedData.body.replace(/<[^>]*>/g, ''),
      from: fromAddress, // Use the determined FROM address
      emailType: 'transactional',
      includeUnsubscribe: false,
    }

    const result = await sendEmail(emailOptions)

    logger.info(`[${requestId}] Email send result`, {
      success: result.success,
      message: result.message,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid request data',
          errors: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error sending email via API:`, error)

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error while sending email',
        data: {},
      },
      { status: 500 }
    )
  }
}
