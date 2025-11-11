import type { SlackMessageReaderParams, SlackMessageReaderResponse } from '@/tools/slack/types'
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
      description: 'Slack channel to read messages from (e.g., #general)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of messages to retrieve (default: 10, max: 100)',
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
    url: (params: SlackMessageReaderParams) => {
      const url = new URL('https://slack.com/api/conversations.history')
      url.searchParams.append('channel', params.channel)
      // Cap limit at 15 due to Slack API restrictions for non-Marketplace apps
      const limit = params.limit ? Number(params.limit) : 10
      url.searchParams.append('limit', String(Math.min(limit, 15)))

      if (params.oldest) {
        url.searchParams.append('oldest', params.oldest)
      }
      if (params.latest) {
        url.searchParams.append('latest', params.latest)
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params: SlackMessageReaderParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const messages = (data.messages || []).map((message: any) => ({
      ts: message.ts,
      text: message.text || '',
      user: message.user || message.bot_id || 'unknown',
      type: message.type || 'message',
      subtype: message.subtype,
      files: message.files?.map((file: any) => ({
        id: file.id,
        name: file.name,
        mimetype: file.mimetype,
        size: file.size,
        url_private: file.url_private,
      })),
    }))

    return {
      success: true,
      output: {
        messages,
      },
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description: 'Array of message objects from the channel',
      items: {
        type: 'object',
        properties: {
          ts: { type: 'string' },
          text: { type: 'string' },
          user: { type: 'string' },
          type: { type: 'string' },
          subtype: { type: 'string' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                mimetype: { type: 'string' },
                size: { type: 'number' },
                url_private: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
}
