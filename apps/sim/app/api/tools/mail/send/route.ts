import { type NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MailSendAPI')

const MailSendSchema = z.object({
  fromAddress: z.string().email('Invalid from email address').min(1, 'From address is required'),
  to: z.string().email('Invalid email address').min(1, 'To email is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
  contentType: z.enum(['text', 'html']).optional().nullable(),
  resendApiKey: z.string().min(1, 'Resend API key is required'),
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

    logger.info(`[${requestId}] Sending email with user-provided Resend API key`, {
      to: validatedData.to,
      subject: validatedData.subject,
      bodyLength: validatedData.body.length,
      from: validatedData.fromAddress,
    })

    const resend = new Resend(validatedData.resendApiKey)

    const contentType = validatedData.contentType || 'text'
    const emailData =
      contentType === 'html'
        ? {
            from: validatedData.fromAddress,
            to: validatedData.to,
            subject: validatedData.subject,
            html: validatedData.body,
            text: validatedData.body.replace(/<[^>]*>/g, ''), // Strip HTML for text version
          }
        : {
            from: validatedData.fromAddress,
            to: validatedData.to,
            subject: validatedData.subject,
            text: validatedData.body,
          }

    const { data, error } = await resend.emails.send(emailData)

    if (error) {
      logger.error(`[${requestId}] Email sending failed:`, error)
      return NextResponse.json(
        {
          success: false,
          message: `Failed to send email: ${error.message || 'Unknown error'}`,
        },
        { status: 500 }
      )
    }

    const result = {
      success: true,
      message: 'Email sent successfully via Resend',
      data,
    }

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
