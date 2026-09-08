import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { SlackListChannelsParams, SlackListChannelsResponse } from '@/tools/slack/types'
import { CONVERSATION_LIST_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { InternalToolConfig } from '@/tools/types'

/** Default Slack conversations.list page size. */
export const DEFAULT_CONVERSATION_PAGE_LIMIT = 100

/** Slack's recommended upper bound for conversations.list page size. */
export const MAX_CONVERSATION_PAGE_LIMIT = 200

/** Default and hard cap on Slack conversation provider pages fetched per invocation. */
export const MAX_CONVERSATION_PAGES = 200

/** Hard cap on Slack conversations accumulated per invocation. */
export const MAX_CONVERSATIONS = 10_000

export const slackListChannelsTool: InternalToolConfig<
  SlackListChannelsParams,
  SlackListChannelsResponse
> = {
  id: 'slack_list_channels',
  name: 'Slack List Channels',
  description:
    'List up to 10,000 accessible public and private Slack channels across as many cursor pages as Slack supplies, capped at 200 provider pages.',
  version: '1.3.0',

  oauth: {
    required: true,
    provider: 'slack',
    /** Slack enforces the required scope for the target conversation type. */
    requiredScopes: [],
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
    includePrivate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include private channels the connected account can access (default: true)',
    },
    excludeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude archived channels (default: true)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversations to request per Slack page (default: 100, max: 200)',
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
      description: 'Maximum number of Slack pages to fetch (default: 200, max: 200)',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    channels: {
      type: 'array',
      description: 'Up to 10,000 accessible public and private channels',
      items: {
        type: 'object',
        properties: CONVERSATION_LIST_OUTPUT_PROPERTIES,
      },
    },
    ids: {
      type: 'array',
      description: 'Conversation IDs for every returned channel',
      items: { type: 'string', description: 'Slack conversation ID' },
    },
    names: {
      type: 'array',
      description: 'Names of returned channels',
      items: { type: 'string', description: 'Slack conversation name' },
    },
    count: {
      type: 'number',
      description: 'Total number of conversations returned across all fetched pages, up to 10,000',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more Slack conversation pages remain beyond the fetched window',
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor to fetch the next page; null when there are no more pages',
      optional: true,
    },
    pages: {
      type: 'number',
      description: 'Number of Slack conversation pages fetched in this invocation',
    },
  },
}
