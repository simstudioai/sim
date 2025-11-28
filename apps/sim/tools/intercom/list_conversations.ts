import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomListConversations')

export interface IntercomListConversationsParams {
  accessToken: string
  per_page?: number
  starting_after?: string
}

export interface IntercomListConversationsResponse {
  success: boolean
  output: {
    conversations: any[]
    pages?: any
    metadata: {
      operation: 'list_conversations'
      total_count?: number
    }
    success: boolean
  }
}

export const intercomListConversationsTool: ToolConfig<
  IntercomListConversationsParams,
  IntercomListConversationsResponse
> = {
  id: 'intercom_list_conversations',
  name: 'List Conversations from Intercom',
  description: 'List all conversations from Intercom with pagination support',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
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
    url: (params) => {
      const url = buildIntercomUrl('/conversations')
      const queryParams = new URLSearchParams()

      if (params.per_page) queryParams.append('per_page', params.per_page.toString())
      if (params.starting_after) queryParams.append('starting_after', params.starting_after)

      const queryString = queryParams.toString()
      return queryString ? `${url}?${queryString}` : url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'list_conversations')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversations: data.conversations || [],
        pages: data.pages,
        metadata: {
          operation: 'list_conversations' as const,
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
      description: 'List of conversations',
      properties: {
        conversations: { type: 'array', description: 'Array of conversation objects' },
        pages: { type: 'object', description: 'Pagination information' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
