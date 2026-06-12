import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { slackSendMessageContract } from '@/lib/api/contracts/tools/communication/slack'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { FileAccessDeniedError } from '@/app/api/files/authorization'
import { sendSlackMessage } from '@/app/api/tools/slack/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackSendMessageAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Slack send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const userId = authResult.userId
    logger.info(`[${requestId}] Authenticated Slack send request via ${authResult.authType}`, {
      userId,
    })

    const parsed = await parseRequest(slackSendMessageContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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
        ownerUserId: userId,
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
    if (error instanceof FileAccessDeniedError) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 })
    }
    logger.error(`[${requestId}] Error sending Slack message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Unknown error occurred'),
      },
      { status: 500 }
    )
  }
})
