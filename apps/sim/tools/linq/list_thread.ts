import type { LinqListMessagesResult, LinqListThreadParams } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqListThreadTool: ToolConfig<LinqListThreadParams, LinqListMessagesResult> = {
  id: 'linq_list_thread',
  name: 'List Thread Messages',
  description: 'List all messages in the thread that contains a given message',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of any message in the thread',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: asc (oldest first) or desc (newest first)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of messages to return',
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
      if (params.order) query.set('order', params.order)
      if (typeof params.limit === 'number') query.set('limit', String(params.limit))
      if (params.cursor) query.set('cursor', params.cursor)
      const qs = query.toString()
      return `${LINQ_API_BASE}/messages/${encodeURIComponent(params.messageId.trim())}/thread${
        qs ? `?${qs}` : ''
      }`
    },
    method: 'GET',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqListMessagesResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to list thread messages'),
        output: { messages: [], nextCursor: null },
      }
    }

    return {
      success: true,
      output: {
        messages: data.messages ?? [],
        nextCursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    messages: { type: 'json', description: 'Array of message objects in the thread' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null if there are no more results',
      optional: true,
    },
  },
}
