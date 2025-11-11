import type { SlackAddReactionParams, SlackAddReactionResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackAddReactionTool: ToolConfig<SlackAddReactionParams, SlackAddReactionResponse> = {
  id: 'slack_add_reaction',
  name: 'Slack Add Reaction',
  description: 'Add an emoji reaction to a Slack message',
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
      description: 'Timestamp of the message to react to (e.g., 1405894322.002768)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the emoji reaction (without colons, e.g., thumbsup, heart, eyes)',
    },
  },

  request: {
    url: '/api/tools/slack/add-reaction',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SlackAddReactionParams) => ({
      accessToken: params.accessToken || params.botToken,
      channel: params.channel,
      timestamp: params.timestamp,
      name: params.name,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          content: data.error || 'Failed to add reaction',
          metadata: {
            channel: '',
            timestamp: '',
            reaction: '',
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
      description: 'Reaction metadata',
      properties: {
        channel: { type: 'string', description: 'Channel ID' },
        timestamp: { type: 'string', description: 'Message timestamp' },
        reaction: { type: 'string', description: 'Emoji reaction name' },
      },
    },
  },
}
