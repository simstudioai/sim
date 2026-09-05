import type { SlackDeleteMessageParams, SlackDeleteMessageResponse } from '@/tools/slack/types'
import { MESSAGE_METADATA_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { InternalToolConfig } from '@/tools/types'

export const slackDeleteMessageTool: InternalToolConfig<
  SlackDeleteMessageParams,
  SlackDeleteMessageResponse
> = {
  id: 'slack_delete_message',
  name: 'Slack Delete Message',
  description: 'Delete a message previously sent by the bot in Slack',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['chat:write'],
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
      description: 'Channel ID where the message was posted (e.g., C1234567890)',
    },
    timestamp: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Timestamp of the message to delete (e.g., 1405894322.002768)',
    },
  },

  operation: {
    input: (params: SlackDeleteMessageParams) => ({
      accessToken: params.accessToken || params.botToken,
      channel: params.channel?.trim(),
      timestamp: params.timestamp?.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          content: data.error || 'Failed to delete message',
          metadata: {
            channel: '',
            timestamp: '',
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
      description: 'Deleted message metadata',
      properties: MESSAGE_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
