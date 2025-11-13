import type { SlackThreadReaderParams, SlackThreadReaderResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackThreadReaderTool: ToolConfig<
  SlackThreadReaderParams,
  SlackThreadReaderResponse
> = {
  id: 'slack_thread_reader',
  name: 'Slack Thread Reader',
  description:
    'Read the full contents of a Slack thread, including the root message and its replies.',
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
      description: 'Slack channel containing the thread (e.g., #support)',
    },
    thread_ts: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Timestamp of the thread root message',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of thread messages to retrieve (default: 20, max: 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for fetching additional thread messages',
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
    url: (params: SlackThreadReaderParams) => {
      const url = new URL('https://slack.com/api/conversations.replies')
      url.searchParams.append('channel', params.channel)
      url.searchParams.append('ts', params.thread_ts)

      const limit = params.limit ? Number(params.limit) : 20
      url.searchParams.append('limit', String(Math.min(limit, 15)))

      if (params.cursor) {
        url.searchParams.append('cursor', params.cursor)
      }
      if (params.oldest) {
        url.searchParams.append('oldest', params.oldest)
      }
      if (params.latest) {
        url.searchParams.append('latest', params.latest)
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params: SlackThreadReaderParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  transformResponse: async (
    response: Response,
    params?: SlackThreadReaderParams
  ): Promise<SlackThreadReaderResponse> => {
    const data = await response.json()

    const messages = (data.messages || []).map((message: any) => ({
      ts: message.ts,
      text: message.text || '',
      user: message.user || message.bot_id || 'unknown',
      type: message.type || 'message',
      subtype: message.subtype,
      thread_ts: message.thread_ts,
      parent_user_id: message.parent_user_id,
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
        thread_ts: params?.thread_ts || data.ts || messages[0]?.thread_ts || messages[0]?.ts || '',
        messages,
        has_more: data.has_more,
        next_cursor: data.response_metadata?.next_cursor,
      },
    }
  },

  outputs: {
    thread_ts: {
      type: 'string',
      description: 'Timestamp of the thread root message used for retrieval',
    },
    messages: {
      type: 'array',
      description: 'Array of messages (root + replies) from the thread',
      items: {
        type: 'object',
        properties: {
          ts: { type: 'string' },
          text: { type: 'string' },
          user: { type: 'string' },
          type: { type: 'string' },
          subtype: { type: 'string' },
          thread_ts: { type: 'string' },
          parent_user_id: { type: 'string' },
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
    has_more: {
      type: 'boolean',
      description: 'Whether additional thread messages can be fetched with the next cursor',
      optional: true,
    },
    next_cursor: {
      type: 'string',
      description: 'Cursor to use for fetching the next page of thread replies',
      optional: true,
    },
  },
}
