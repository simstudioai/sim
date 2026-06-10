import type {
  SlackGetThreadRepliesParams,
  SlackGetThreadRepliesResponse,
} from '@/tools/slack/types'
import { MESSAGE_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import { fetchSlackMessagesPaginated, resolvePositiveInt } from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

/** Default cap on pages fetched per invocation. */
const DEFAULT_MAX_PAGES = 10

export const slackGetThreadRepliesTool: ToolConfig<
  SlackGetThreadRepliesParams,
  SlackGetThreadRepliesResponse
> = {
  id: 'slack_get_thread_replies',
  name: 'Slack Get Thread Replies',
  description:
    'Fetch every message in a Slack thread, automatically following pagination across all pages. Returns the parent message and the full set of replies.',
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
      description: 'Slack channel ID containing the thread (e.g., C1234567890)',
    },
    threadTs: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thread timestamp (thread_ts) of the parent message (e.g., 1405894322.002768)',
    },
    oldest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include replies after this Unix timestamp (seconds)',
    },
    latest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include replies before this Unix timestamp (seconds)',
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
    url: () => 'https://slack.com/api/conversations.replies',
    method: 'GET',
    headers: (params: SlackGetThreadRepliesParams) => ({
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  directExecution: async (params: SlackGetThreadRepliesParams) => {
    const token = params.accessToken || params.botToken
    if (!token) {
      throw new Error('Missing Slack credentials. Provide an OAuth connection or a bot token.')
    }

    const result = await fetchSlackMessagesPaginated({
      token,
      method: 'conversations.replies',
      baseParams: {
        channel: params.channel,
        ts: params.threadTs,
        oldest: params.oldest,
        latest: params.latest,
        inclusive: params.inclusive ? 'true' : undefined,
      },
      limit: resolvePositiveInt(params.limit, 200),
      cursor: params.cursor,
      maxPages: resolvePositiveInt(params.maxPages, DEFAULT_MAX_PAGES),
      missingScopeHint: 'channels:history, groups:history, im:history, mpim:history',
    })

    const messages = result.messages
    const threadTs = params.threadTs?.trim()
    const parentMessage = messages.find((msg) => msg.ts === threadTs) ?? null
    const replies = parentMessage ? messages.filter((msg) => msg !== parentMessage) : messages

    return {
      success: true,
      output: {
        parentMessage,
        replies,
        messages,
        replyCount: replies.length,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        pages: result.pages,
      },
    }
  },

  outputs: {
    parentMessage: {
      type: 'object',
      description: 'The thread parent message, or null if the thread is empty',
      properties: MESSAGE_OUTPUT_PROPERTIES,
      optional: true,
    },
    replies: {
      type: 'array',
      description: 'All reply messages in the thread (excluding the parent)',
      items: {
        type: 'object',
        properties: MESSAGE_OUTPUT_PROPERTIES,
      },
    },
    messages: {
      type: 'array',
      description: 'All messages (parent + replies) in chronological order',
      items: {
        type: 'object',
        properties: MESSAGE_OUTPUT_PROPERTIES,
      },
    },
    replyCount: {
      type: 'number',
      description: 'Number of replies returned (excluding the parent)',
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
