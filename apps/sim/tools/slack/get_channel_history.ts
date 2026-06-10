import type {
  SlackGetChannelHistoryParams,
  SlackGetChannelHistoryResponse,
} from '@/tools/slack/types'
import { MESSAGE_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import { fetchSlackMessagesPaginated, resolvePositiveInt } from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

/** Default cap on pages fetched per invocation. */
const DEFAULT_MAX_PAGES = 10

export const slackGetChannelHistoryTool: ToolConfig<
  SlackGetChannelHistoryParams,
  SlackGetChannelHistoryResponse
> = {
  id: 'slack_get_channel_history',
  name: 'Slack Get Channel History',
  description:
    'Fetch message history from a Slack channel, automatically following pagination. Optionally filter by a time range to scrape messages since a given timestamp.',
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
      description: 'Slack channel ID (e.g., C1234567890)',
    },
    oldest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include messages after this Unix timestamp (seconds, e.g., 1700000000)',
    },
    latest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include messages before this Unix timestamp (seconds)',
    },
    inclusive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include messages with timestamps matching oldest or latest (default: false)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Messages to request per page (default: 200, max: 999)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response.nextCursor to resume from',
    },
    maxPages: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of pages to fetch before stopping (default: 10)',
    },
  },

  request: {
    url: () => 'https://slack.com/api/conversations.history',
    method: 'GET',
    headers: (params: SlackGetChannelHistoryParams) => ({
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  directExecution: async (params: SlackGetChannelHistoryParams) => {
    const token = params.accessToken || params.botToken
    if (!token) {
      throw new Error('Missing Slack credentials. Provide an OAuth connection or a bot token.')
    }

    const result = await fetchSlackMessagesPaginated({
      token,
      method: 'conversations.history',
      baseParams: {
        channel: params.channel,
        oldest: params.oldest,
        latest: params.latest,
        inclusive: params.inclusive ? 'true' : undefined,
      },
      limit: resolvePositiveInt(params.limit, 200),
      cursor: params.cursor,
      maxPages: resolvePositiveInt(params.maxPages, DEFAULT_MAX_PAGES),
      missingScopeHint: 'channels:history, groups:history, im:history, mpim:history',
    })

    return {
      success: true,
      output: {
        messages: result.messages,
        count: result.messages.length,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        pages: result.pages,
      },
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description: 'Channel messages in reverse-chronological order (newest first)',
      items: {
        type: 'object',
        properties: MESSAGE_OUTPUT_PROPERTIES,
      },
    },
    count: {
      type: 'number',
      description: 'Total number of messages returned across all fetched pages',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more pages remain beyond the fetched window',
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor to fetch the next page; null when there are no more pages',
      optional: true,
    },
    pages: {
      type: 'number',
      description: 'Number of pages fetched in this invocation',
    },
  },
}
