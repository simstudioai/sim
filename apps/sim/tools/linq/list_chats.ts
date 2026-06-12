import type { LinqListChatsParams, LinqListChatsResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqListChatsTool: ToolConfig<LinqListChatsParams, LinqListChatsResult> = {
  id: 'linq_list_chats',
  name: 'List Chats',
  description: 'List chats, optionally filtered by sender or participant handle',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by sender phone number in E.164 format',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by participant handle (phone number or email)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (default 20, max 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.from) query.set('from', params.from)
      if (params.to) query.set('to', params.to)
      if (typeof params.limit === 'number') query.set('limit', String(params.limit))
      if (params.cursor) query.set('cursor', params.cursor)
      const qs = query.toString()
      return `${LINQ_API_BASE}/chats${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqListChatsResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to list chats'),
        output: { chats: [], nextCursor: null },
      }
    }

    return {
      success: true,
      output: {
        chats: data.chats ?? [],
        nextCursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    chats: { type: 'json', description: 'Array of chat objects' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null if there are no more results',
      optional: true,
    },
  },
}
