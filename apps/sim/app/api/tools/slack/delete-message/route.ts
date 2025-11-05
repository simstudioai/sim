import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackDeleteMessageAPI')

const SlackDeleteMessageSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  channel: z.string().min(1, 'Channel ID is required'),
  timestamp: z.string().min(1, 'Message timestamp is required'),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack delete message attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Slack delete message request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = SlackDeleteMessageSchema.parse(body)

    logger.info(`[${requestId}] Deleting Slack message`, {
      channel: validatedData.channel,
      timestamp: validatedData.timestamp,
    })

    const slackResponse = await fetch('https://slack.com/api/chat.delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: JSON.stringify({
        channel: validatedData.channel,
        ts: validatedData.timestamp,
      }),
    })

    const data = await slackResponse.json()

    if (!data.ok) {
      logger.error(`[${requestId}] Slack API error:`, data)
      return NextResponse.json(
        {
          success: false,
          error: data.error || 'Failed to delete message',
        },
        { status: slackResponse.status }
      )
    }

    logger.info(`[${requestId}] Message deleted successfully`, {
      channel: data.channel,
      timestamp: data.ts,
    })

    return NextResponse.json({
      success: true,
      output: {
        content: 'Message deleted successfully',
        metadata: {
          channel: data.channel,
          timestamp: data.ts,
        },
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error deleting Slack message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
