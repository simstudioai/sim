import type { SlackScheduleMessageParams, SlackScheduleMessageResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackScheduleMessageTool: ToolConfig<
  SlackScheduleMessageParams,
  SlackScheduleMessageResponse
> = {
  id: 'slack_schedule_message',
  name: 'Slack Schedule Message',
  description: 'Schedule a message to be sent to a Slack channel or DM at a future time.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'slack',
  },

  params: {
    authMethod: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Authentication method: oauth or bot_token',
    },
    botToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Bot token for Custom Bot',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token or bot token for Slack API',
    },
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel, private group, or DM to receive the message (e.g., C1234567890)',
    },
    postAt: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unix timestamp (seconds) representing the future time the message should post',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message text to send (supports Slack mrkdwn formatting)',
    },
    blocks: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Block Kit layout blocks as a JSON array. When provided, text becomes the fallback notification text.',
    },
    threadTs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Thread timestamp to reply to (creates a scheduled thread reply)',
    },
  },

  request: {
    url: 'https://slack.com/api/chat.scheduleMessage',
    method: 'POST',
    headers: (params: SlackScheduleMessageParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackScheduleMessageParams) => {
      const body: Record<string, unknown> = {
        channel: params.channel?.trim(),
        post_at: params.postAt,
      }
      if (params.text) {
        body.text = params.text
      }
      if (params.blocks) {
        body.blocks = typeof params.blocks === 'string' ? JSON.parse(params.blocks) : params.blocks
      }
      if (params.threadTs?.trim()) {
        body.thread_ts = params.threadTs.trim()
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'time_in_past' || data.error === 'time_too_far') {
        throw new Error(
          'The scheduled time is invalid. It must be in the future and within 120 days.'
        )
      }
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the necessary scope (chat:write).'
        )
      }
      if (data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please verify the channel ID.')
      }
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      throw new Error(data.error || 'Failed to schedule Slack message')
    }

    return {
      success: true,
      output: {
        scheduledMessageId: data.scheduled_message_id,
        postAt: data.post_at,
        channel: data.channel,
        message: data.message || {},
      },
    }
  },

  outputs: {
    scheduledMessageId: {
      type: 'string',
      description: 'Identifier of the scheduled message (used to delete it before it posts)',
    },
    postAt: { type: 'number', description: 'Unix timestamp when the message will post' },
    channel: { type: 'string', description: 'Channel ID where the message is scheduled' },
    message: { type: 'object', description: 'The scheduled message object returned by Slack' },
  },
}
