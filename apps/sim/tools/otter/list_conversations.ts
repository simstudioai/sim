import type {
  OtterListConversationsParams,
  OtterListConversationsResponse,
} from '@/tools/otter/types'
import {
  mapOtterConversation,
  OTTER_API_BASE,
  OTTER_CONVERSATION_PROPERTIES,
  OTTER_PAGINATION_OUTPUTS,
  otterHeaders,
  parseOtterLimit,
  readOtterDataList,
  readOtterPagination,
} from '@/tools/otter/utils'
import type { ToolConfig } from '@/tools/types'

export const otterListConversationsTool: ToolConfig<
  OtterListConversationsParams,
  OtterListConversationsResponse
> = {
  id: 'otter_list_conversations',
  name: 'Otter List Conversations',
  description:
    'List Otter conversations for the authenticated user, most recent first, optionally including shared conversations or filtering by channel.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Otter API key',
    },
    includeShared: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include conversations shared with the user (default false). Automatically true when a channel ID is provided.',
    },
    channelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return conversations in this channel. Overrides includeShared.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of conversations per page (1-100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor (nextCursor from a previous response)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${OTTER_API_BASE}/conversations`)
      const channelId = params.channelId?.trim()
      // Otter lets channel_id override include_shared, so the flag is only sent without one.
      if (channelId) {
        url.searchParams.set('channel_id', channelId)
      } else if (params.includeShared !== undefined && params.includeShared !== null) {
        url.searchParams.set('include_shared', String(params.includeShared))
      }
      const limit = parseOtterLimit(params.limit)
      if (limit !== undefined) url.searchParams.set('limit', String(limit))
      const cursor = params.cursor?.trim()
      if (cursor) url.searchParams.set('cursor', cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => otterHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const body = await response.json()
    return {
      success: true,
      output: {
        conversations: readOtterDataList(body).map(mapOtterConversation),
        ...readOtterPagination(body),
      },
    }
  },

  outputs: {
    conversations: {
      type: 'array',
      description: 'Conversations, most recent first',
      items: { type: 'object', properties: OTTER_CONVERSATION_PROPERTIES },
    },
    ...OTTER_PAGINATION_OUTPUTS,
  },
}
