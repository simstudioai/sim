import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { openDMChannel } from '../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackReadMessagesAPI')

const SlackReadMessagesSchema = z
  .object({
    accessToken: z.string().min(1, 'Access token is required'),
    channel: z.string().optional().nullable(),
    userId: z.string().optional().nullable(),
    limit: z.coerce
      .number()
      .min(1, 'Limit must be at least 1')
      .max(15, 'Limit cannot exceed 15')
      .optional()
      .nullable(),
    oldest: z.string().optional().nullable(),
    latest: z.string().optional().nullable(),
  })
  .refine((data) => data.channel || data.userId, {
    message: 'Either channel or userId is required',
  })

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack read messages attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Slack read messages request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = SlackReadMessagesSchema.parse(body)

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

    const url = new URL('https://slack.com/api/conversations.history')
    url.searchParams.append('channel', channel!)
    const limit = validatedData.limit ?? 10
    url.searchParams.append('limit', String(limit))

    if (validatedData.oldest) {
      url.searchParams.append('oldest', validatedData.oldest)
    }
    if (validatedData.latest) {
      url.searchParams.append('latest', validatedData.latest)
    }

    logger.info(`[${requestId}] Reading Slack messages`, {
      channel,
      limit,
    })

    const slackResponse = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
    })

    const data = await slackResponse.json()

    if (!data.ok) {
      logger.error(`[${requestId}] Slack API error:`, data)

      if (data.error === 'not_in_channel') {
        return NextResponse.json(
          {
            success: false,
            error:
              'Bot is not in the channel. Please invite the Sim bot to your Slack channel by typing: /invite @Sim Studio',
          },
          { status: 400 }
        )
      }
      if (data.error === 'channel_not_found') {
        return NextResponse.json(
          {
            success: false,
            error: 'Channel not found. Please check the channel ID and try again.',
          },
          { status: 400 }
        )
      }
      if (data.error === 'missing_scope') {
        return NextResponse.json(
          {
            success: false,
            error:
              'Missing required permissions. Please reconnect your Slack account with the necessary scopes (channels:history, groups:history, im:history).',
          },
          { status: 400 }
        )
      }

      return NextResponse.json(
        {
          success: false,
          error: data.error || 'Failed to fetch messages',
        },
        { status: 400 }
      )
    }

    const messages = (data.messages || []).map((message: any) => ({
      type: message.type || 'message',
      ts: message.ts,
      text: message.text || '',
      user: message.user,
      bot_id: message.bot_id,
      username: message.username,
      channel: message.channel,
      team: message.team,
      thread_ts: message.thread_ts,
      parent_user_id: message.parent_user_id,
      reply_count: message.reply_count,
      reply_users_count: message.reply_users_count,
      latest_reply: message.latest_reply,
      subscribed: message.subscribed,
      last_read: message.last_read,
      unread_count: message.unread_count,
      subtype: message.subtype,
      reactions: message.reactions?.map((reaction: any) => ({
        name: reaction.name,
        count: reaction.count,
        users: reaction.users || [],
      })),
      is_starred: message.is_starred,
      pinned_to: message.pinned_to,
      files: message.files?.map((file: any) => ({
        id: file.id,
        name: file.name,
        mimetype: file.mimetype,
        size: file.size,
        url_private: file.url_private,
        permalink: file.permalink,
        mode: file.mode,
      })),
      attachments: message.attachments,
      blocks: message.blocks,
      edited: message.edited
        ? {
            user: message.edited.user,
            ts: message.edited.ts,
          }
        : undefined,
      permalink: message.permalink,
    }))

    logger.info(`[${requestId}] Successfully read ${messages.length} messages`)

    return NextResponse.json({
      success: true,
      output: {
        messages,
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

    logger.error(`[${requestId}] Error reading Slack messages:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
