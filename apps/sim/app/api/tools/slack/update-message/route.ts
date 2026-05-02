import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { slackUpdateMessageContract } from '@/lib/api/contracts/tools/communication/slack'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackUpdateMessageAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack update message attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Slack update message request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseRequest(slackUpdateMessageContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Updating Slack message`, {
      channel: validatedData.channel,
      timestamp: validatedData.timestamp,
    })

    const slackResponse = await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: JSON.stringify({
        channel: validatedData.channel,
        ts: validatedData.timestamp,
        text: validatedData.text,
        ...(validatedData.blocks &&
          validatedData.blocks.length > 0 && { blocks: validatedData.blocks }),
      }),
    })

    const data = await slackResponse.json()

    if (!data.ok) {
      logger.error(`[${requestId}] Slack API error:`, data)
      return NextResponse.json(
        {
          success: false,
          error: data.error || 'Failed to update message',
        },
        { status: slackResponse.status }
      )
    }

    logger.info(`[${requestId}] Message updated successfully`, {
      channel: data.channel,
      timestamp: data.ts,
    })

    const messageObj = data.message || {
      type: 'message',
      ts: data.ts,
      text: data.text || validatedData.text,
      channel: data.channel,
    }

    return NextResponse.json({
      success: true,
      output: {
        message: messageObj,
        content: 'Message updated successfully',
        metadata: {
          channel: data.channel,
          timestamp: data.ts,
          text: data.text || validatedData.text,
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating Slack message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
})
