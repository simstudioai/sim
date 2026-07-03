import type {
  SlackDeleteScheduledMessageParams,
  SlackDeleteScheduledMessageResponse,
} from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackDeleteScheduledMessageTool: ToolConfig<
  SlackDeleteScheduledMessageParams,
  SlackDeleteScheduledMessageResponse
> = {
  id: 'slack_delete_scheduled_message',
  name: 'Slack Delete Scheduled Message',
  description: 'Delete a pending scheduled message before it posts to Slack.',
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
      description: 'Channel ID where the scheduled message is queued (e.g., C1234567890)',
    },
    scheduledMessageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Scheduled message ID from chat.scheduleMessage (e.g., Q1234ABCD)',
    },
  },

  request: {
    url: 'https://slack.com/api/chat.deleteScheduledMessage',
    method: 'POST',
    headers: (params: SlackDeleteScheduledMessageParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackDeleteScheduledMessageParams) => ({
      channel: params.channel?.trim(),
      scheduled_message_id: params.scheduledMessageId?.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'invalid_scheduled_message_id') {
        throw new Error(
          'Invalid scheduled message ID. The message may have already posted or is set to post within 60 seconds.'
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
      throw new Error(data.error || 'Failed to delete scheduled Slack message')
    }

    return {
      success: true,
      output: {
        ok: true,
      },
    }
  },

  outputs: {
    ok: {
      type: 'boolean',
      description: 'Whether the scheduled message was deleted successfully',
    },
  },
}
