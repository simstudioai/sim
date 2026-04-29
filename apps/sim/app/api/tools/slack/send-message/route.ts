import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { slackSendMessageBodySchema } from '@/lib/api/contracts'
import { getValidationErrorMessage, validateJsonBody } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sendSlackMessage } from '../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackSendMessageAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Slack send request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const validation = await validateJsonBody(request, slackSendMessageBodySchema)
    if (!validation.success) {
      if (!validation.error) return validation.response
      return NextResponse.json(
        {
          success: false,
          error: getValidationErrorMessage(validation.error, 'Invalid request'),
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }
    const validatedData = validation.data

    const isDM = !!validatedData.userId
    logger.info(`[${requestId}] Sending Slack message`, {
      channel: validatedData.channel,
      userId: validatedData.userId,
      isDM,
      hasFiles: !!(validatedData.files && validatedData.files.length > 0),
      fileCount: validatedData.files?.length || 0,
    })

    const result = await sendSlackMessage(
      {
        accessToken: validatedData.accessToken,
        channel: validatedData.channel ?? undefined,
        userId: validatedData.userId ?? undefined,
        text: validatedData.text,
        threadTs: validatedData.thread_ts ?? undefined,
        blocks: validatedData.blocks ?? undefined,
        files: validatedData.files ?? undefined,
      },
      requestId,
      logger
    )

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true, output: result.output })
  } catch (error) {
    logger.error(`[${requestId}] Error sending Slack message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
})
