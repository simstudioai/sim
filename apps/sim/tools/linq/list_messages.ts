import type { LinqListMessagesParams, LinqListMessagesResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqListMessagesTool: ToolConfig<LinqListMessagesParams, LinqListMessagesResult> = {
  id: 'linq_list_messages',
  name: 'List Messages',
  description: 'List messages in a chat with pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the chat',
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
      if (typeof params.limit === 'number') query.set('limit', String(params.limit))
      if (params.cursor) query.set('cursor', params.cursor)
      const qs = query.toString()
      return `${LINQ_API_BASE}/chats/${encodeURIComponent(params.chatId.trim())}/messages${
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
        error: extractLinqError(data, 'Failed to list messages'),
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
    messages: { type: 'json', description: 'Array of message objects with parts and reactions' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null if there are no more results',
      optional: true,
    },
  },
}
