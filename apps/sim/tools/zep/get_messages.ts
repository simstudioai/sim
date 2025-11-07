import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'

// Get Messages Tool - Retrieve messages from a thread (Zep v3)
export const zepGetMessagesTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_get_messages',
  name: 'Get Messages',
  description: 'Retrieve messages from a thread',
  version: '1.0.0',

  params: {
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thread ID to get messages from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of messages to return',
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
      visibility: 'user-only',
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
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`Zep API error (${response.status}): ${text || response.statusText}`)
    }

    const data = JSON.parse(text.replace(/^\uFEFF/, '').trim())

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
    messages: {
      type: 'array',
      description: 'Array of message objects',
    },
    rowCount: {
      type: 'number',
      description: 'Number of messages in this response',
    },
    totalCount: {
      type: 'number',
      description: 'Total number of messages in the thread',
    },
  },
}
