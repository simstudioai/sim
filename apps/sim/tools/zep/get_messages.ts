import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'
import { MESSAGES_ARRAY_OUTPUT, PAGINATION_OUTPUT_PROPERTIES } from '@/tools/zep/types'

export const zepGetMessagesTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_get_messages',
  name: 'Get Messages',
  description: 'Retrieve messages from a thread',
  version: '1.0.0',

  params: {
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thread ID to get messages from (e.g., "thread_abc123")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of messages to return (e.g., 10, 50, 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Cursor for pagination',
    },
    lastn: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of most recent messages to return (overrides limit and cursor)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zep API key',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.append('limit', String(Number(params.limit)))
      if (params.cursor) queryParams.append('cursor', params.cursor)
      if (params.lastn) queryParams.append('lastn', String(Number(params.lastn)))

      const queryString = queryParams.toString()
      return `https://api.getzep.com/api/v2/threads/${params.threadId}/messages${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Api-Key ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Zep API error (${response.status}): ${error || response.statusText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        messages: data.messages || [],
        rowCount: data.row_count,
        totalCount: data.total_count,
      },
    }
  },

  outputs: {
    messages: MESSAGES_ARRAY_OUTPUT,
    rowCount: PAGINATION_OUTPUT_PROPERTIES.rowCount,
    totalCount: PAGINATION_OUTPUT_PROPERTIES.totalCount,
  },
}
