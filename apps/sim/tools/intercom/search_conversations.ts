import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomSearchConversations')

export interface IntercomSearchConversationsParams {
  accessToken: string
  query: string
  per_page?: number
  starting_after?: string
}

export interface IntercomSearchConversationsResponse {
  success: boolean
  output: {
    conversations: any[]
    pages?: any
    metadata: {
      operation: 'search_conversations'
      total_count?: number
    }
    success: boolean
  }
}

export const intercomSearchConversationsTool: ToolConfig<
  IntercomSearchConversationsParams,
  IntercomSearchConversationsResponse
> = {
  id: 'intercom_search_conversations',
  name: 'Search Conversations in Intercom',
  description: 'Search for conversations in Intercom using a query',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Search query as JSON object',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results per page (max: 150)',
    },
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Cursor for pagination',
    },
  },

  request: {
    url: () => buildIntercomUrl('/conversations/search'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params) => {
      let query
      try {
        query = JSON.parse(params.query)
      } catch (error) {
        logger.warn('Failed to parse search query, using default', { error })
        query = {
          field: 'updated_at',
          operator: '>',
          value: Math.floor(Date.now() / 1000) - 86400, // Last 24 hours
        }
      }

      const body: any = { query }

      if (params.per_page) body.pagination = { per_page: params.per_page }
      if (params.starting_after)
        body.pagination = { ...body.pagination, starting_after: params.starting_after }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'search_conversations')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversations: data.conversations || [],
        pages: data.pages,
        metadata: {
          operation: 'search_conversations' as const,
          total_count: data.total_count,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Search results',
      properties: {
        conversations: { type: 'array', description: 'Array of matching conversation objects' },
        pages: { type: 'object', description: 'Pagination information' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
