import type { SlackMessageReaderParams, SlackMessageReaderResponse } from '@/tools/slack/types'
import { MESSAGE_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackMessageReaderTool: ToolConfig<
  SlackMessageReaderParams,
  SlackMessageReaderResponse
> = {
  id: 'slack_message_reader',
  name: 'Slack Message Reader',
  description:
    'Read the latest messages from Slack channels. Retrieve conversation history with filtering options.',
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
    destinationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Destination type: channel or dm',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Slack channel ID to read messages from (e.g., C1234567890)',
    },
    dmUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Slack user ID for DM conversation (e.g., U1234567890)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of messages to retrieve (default: 10, max: 15)',
    },
    oldest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start of time range (timestamp)',
    },
    latest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of time range (timestamp)',
    },
  },

  request: {
    url: '/api/tools/slack/read-messages',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SlackMessageReaderParams) => {
      const isDM = params.destinationType === 'dm'
      return {
        accessToken: params.accessToken || params.botToken,
        channel: isDM ? undefined : params.channel,
        userId: isDM ? params.dmUserId : params.userId,
        limit: params.limit,
        oldest: params.oldest,
        latest: params.latest,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch messages from Slack')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description: 'Array of message objects from the channel',
      items: {
        type: 'object',
        properties: MESSAGE_OUTPUT_PROPERTIES,
      },
    },
  },
}
