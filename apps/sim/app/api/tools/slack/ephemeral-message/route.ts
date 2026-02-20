import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { openDMChannel, postSlackEphemeralMessage } from '../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackEphemeralMessageAPI')

const SlackEphemeralMessageSchema = z
  .object({
    accessToken: z.string().min(1, 'Access token is required'),
    channel: z.string().optional().nullable(),
    dmUserId: z.string().optional().nullable(),
    userId: z.string().min(1, 'User ID is required'),
    text: z.string().min(1, 'Message text is required'),
    thread_ts: z.string().optional().nullable(),
  })
  .refine((data) => data.channel || data.dmUserId, {
    message: 'Either channel or dmUserId is required',
  })

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack ephemeral send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Slack ephemeral send request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = SlackEphemeralMessageSchema.parse(body)

    let channel = validatedData.channel

    if (!channel && validatedData.dmUserId) {
      logger.info(`[${requestId}] Opening DM channel for user: ${validatedData.dmUserId}`)
      channel = await openDMChannel(
        validatedData.accessToken,
        validatedData.dmUserId,
        requestId,
        logger
      )
    }

    if (!channel) {
      return NextResponse.json(
        { success: false, error: 'Either channel or dmUserId is required' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Sending Slack ephemeral message`, {
      channel,
      targetUser: validatedData.userId,
      hasThread: !!validatedData.thread_ts,
    })

    const result = await postSlackEphemeralMessage(
      validatedData.accessToken,
      channel,
      validatedData.userId,
      validatedData.text,
      validatedData.thread_ts
    )

    if (!result.ok) {
      logger.error(`[${requestId}] Slack API error:`, result.error)
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to send ephemeral message' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Ephemeral message sent successfully`)

    return NextResponse.json({
      success: true,
      output: {
        message_ts: result.message_ts,
        channel,
        user: validatedData.userId,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error sending Slack ephemeral message:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
