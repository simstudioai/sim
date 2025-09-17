import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { type SMSOptions, sendSMS } from '@/lib/sms/service'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SMSSendAPI')

const SMSSendSchema = z.object({
  to: z.string().min(1, 'To phone number is required'),
  body: z.string().min(1, 'SMS body is required'),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized SMS send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          message: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated SMS request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = SMSSendSchema.parse(body)

    const fromNumber = env.TWILIO_PHONE_NUMBER

    if (!fromNumber) {
      logger.error(`[${requestId}] SMS sending failed: No phone number configured`)
      return NextResponse.json(
        {
          success: false,
          message: 'SMS sending failed: No phone number configured.',
        },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Sending SMS via internal SMS API`, {
      to: validatedData.to,
      bodyLength: validatedData.body.length,
      from: fromNumber,
    })

    const smsOptions: SMSOptions = {
      to: validatedData.to,
      body: validatedData.body,
      from: fromNumber,
    }

    const result = await sendSMS(smsOptions)

    logger.info(`[${requestId}] SMS send result`, {
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

    logger.error(`[${requestId}] Error sending SMS via API:`, error)

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error while sending SMS',
        data: {},
      },
      { status: 500 }
    )
  }
}
