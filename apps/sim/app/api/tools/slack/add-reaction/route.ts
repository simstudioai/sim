import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { createLogger } from '@/lib/logs/console/logger'
import { openDMChannel } from '../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackAddReactionAPI')

const SlackAddReactionSchema = z
  .object({
    accessToken: z.string().min(1, 'Access token is required'),
    channel: z.string().optional(),
    userId: z.string().optional(),
    timestamp: z.string().min(1, 'Message timestamp is required'),
    name: z.string().min(1, 'Emoji name is required'),
  })
  .refine((data) => data.channel || data.userId, {
    message: 'Either channel or userId is required',
  })

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack add reaction attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Slack add reaction request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = SlackAddReactionSchema.parse(body)

    let channel = validatedData.channel
    if (!channel && validatedData.userId) {
      logger.info(`[${requestId}] Opening DM channel for user: ${validatedData.userId}`)
      channel = await openDMChannel(
        validatedData.accessToken,
        validatedData.userId,
        requestId,
        logger
      )
    }

    logger.info(`[${requestId}] Adding Slack reaction`, {
      channel,
      timestamp: validatedData.timestamp,
      emoji: validatedData.name,
    })

    const slackResponse = await fetch('https://slack.com/api/reactions.add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: JSON.stringify({
        channel,
        timestamp: validatedData.timestamp,
        name: validatedData.name,
      }),
    })

    const data = await slackResponse.json()

    if (!data.ok) {
      logger.error(`[${requestId}] Slack API error:`, data)
      return NextResponse.json(
        {
          success: false,
          error: data.error || 'Failed to add reaction',
        },
        { status: slackResponse.status }
      )
    }

    logger.info(`[${requestId}] Reaction added successfully`, {
      channel,
      timestamp: validatedData.timestamp,
      reaction: validatedData.name,
    })

    return NextResponse.json({
      success: true,
      output: {
        content: `Successfully added :${validatedData.name}: reaction`,
        metadata: {
          channel,
          timestamp: validatedData.timestamp,
          reaction: validatedData.name,
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

    logger.error(`[${requestId}] Error adding Slack reaction:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
