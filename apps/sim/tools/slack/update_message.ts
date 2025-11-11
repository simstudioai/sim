import type { SlackUpdateMessageParams, SlackUpdateMessageResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackUpdateMessageTool: ToolConfig<
  SlackUpdateMessageParams,
  SlackUpdateMessageResponse
> = {
  id: 'slack_update_message',
  name: 'Slack Update Message',
  description: 'Update a message previously sent by the bot in Slack',
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
      visibility: 'user-only',
      description: 'Channel ID where the message was posted (e.g., C1234567890)',
    },
    timestamp: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Timestamp of the message to update (e.g., 1405894322.002768)',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New message text (supports Slack mrkdwn formatting)',
    },
  },

  request: {
    url: '/api/tools/slack/update-message',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SlackUpdateMessageParams) => ({
      accessToken: params.accessToken || params.botToken,
      channel: params.channel,
      timestamp: params.timestamp,
      text: params.text,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          content: data.error || 'Failed to update message',
          metadata: {
            channel: '',
            timestamp: '',
            text: '',
          },
        },
        error: data.error,
      }
    }

    return {
      success: true,
      output: {
        content: data.output.content,
        metadata: data.output.metadata,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Success message' },
    metadata: {
      type: 'object',
      description: 'Updated message metadata',
      properties: {
        channel: { type: 'string', description: 'Channel ID' },
        timestamp: { type: 'string', description: 'Message timestamp' },
        text: { type: 'string', description: 'Updated message text' },
      },
    },
  },
}
