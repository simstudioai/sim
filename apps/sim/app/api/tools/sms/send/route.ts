import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { smsSendContract } from '@/lib/api/contracts/tools/communication/messaging'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { type SMSOptions, sendSMS } from '@/lib/messaging/sms/service'

export const dynamic = 'force-dynamic'

const logger = createLogger('SMSSendAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

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

    const parsed = await parseRequest(smsSendContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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
})
