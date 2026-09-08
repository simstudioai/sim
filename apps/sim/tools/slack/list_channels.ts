import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { SlackListChannelsParams, SlackListChannelsResponse } from '@/tools/slack/types'
import { CONVERSATION_LIST_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { InternalToolConfig } from '@/tools/types'

/** Default Slack conversations.list page size. */
export const DEFAULT_CONVERSATION_PAGE_LIMIT = 100

/** Slack's recommended upper bound for conversations.list page size. */
export const MAX_CONVERSATION_PAGE_LIMIT = 200

export const slackListChannelsTool: InternalToolConfig<
  SlackListChannelsParams,
  SlackListChannelsResponse
> = {
  id: 'slack_list_channels',
  name: 'Slack List Channels',
  description:
    'List one page of accessible public and private Slack channels. Pass the returned nextCursor as cursor to fetch the next page.',
  version: '1.3.1',

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
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    channels: {
      type: 'array',
      description: 'One page of accessible public and private channels',
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
      description: 'Number of conversations returned in this page',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether a next cursor is available to fetch more Slack conversations',
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor to fetch the next page; null when there are no more pages',
      optional: true,
    },
  },
}
