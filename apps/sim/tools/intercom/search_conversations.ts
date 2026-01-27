import { createLogger } from '@sim/logger'
import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('IntercomSearchConversations')

export interface IntercomSearchConversationsParams {
  accessToken: string
  query: string
  per_page?: number
  starting_after?: string
  sort_field?: string
  sort_order?: 'ascending' | 'descending'
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

export interface IntercomSearchConversationsV2Response {
  success: boolean
  output: {
    conversations: any[]
    pages?: any
    total_count?: number
    success: boolean
  }
}

const searchConversationsBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query as JSON object',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max: 150)',
    },
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
    },
    sort_field: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by (e.g., "created_at", "updated_at")',
    },
    sort_order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: "ascending" or "descending"',
    },
  },
  request: {
    url: () => buildIntercomUrl('/conversations/search'),
    method: 'POST',
    headers: (params: IntercomSearchConversationsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomSearchConversationsParams) => {
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

      if (params.sort_field) {
        body.sort = {
          field: params.sort_field,
          order: params.sort_order || 'descending',
        }
      }

      return body
    },
  },
} satisfies Pick<ToolConfig<IntercomSearchConversationsParams, any>, 'params' | 'request'>

export const intercomSearchConversationsTool: ToolConfig<
  IntercomSearchConversationsParams,
  IntercomSearchConversationsResponse
> = {
  id: 'intercom_search_conversations',
  name: 'Search Conversations in Intercom',
  description: 'Search for conversations in Intercom using a query',
  version: '1.0.0',

  ...searchConversationsBase,

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
    conversations: {
      type: 'array',
      description: 'Array of matching conversation objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the conversation' },
          type: { type: 'string', description: 'Object type (conversation)' },
          title: { type: 'string', description: 'Title of the conversation' },
          created_at: {
            type: 'number',
            description: 'Unix timestamp when conversation was created',
          },
          updated_at: {
            type: 'number',
            description: 'Unix timestamp when conversation was last updated',
          },
          waiting_since: { type: 'number', description: 'Unix timestamp when waiting for reply' },
          open: { type: 'boolean', description: 'Whether the conversation is open' },
          state: { type: 'string', description: 'State of the conversation' },
          read: { type: 'boolean', description: 'Whether the conversation has been read' },
          priority: { type: 'string', description: 'Priority of the conversation' },
          admin_assignee_id: { type: 'number', description: 'ID of assigned admin' },
          team_assignee_id: { type: 'string', description: 'ID of assigned team' },
          tags: { type: 'object', description: 'Tags on the conversation' },
          source: { type: 'object', description: 'Source of the conversation' },
          contacts: { type: 'object', description: 'Contacts in the conversation' },
        },
      },
    },
    pages: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        type: { type: 'string', description: 'Pages type identifier' },
        page: { type: 'number', description: 'Current page number' },
        per_page: { type: 'number', description: 'Number of results per page' },
        total_pages: { type: 'number', description: 'Total number of pages' },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: {
          type: 'string',
          description: 'The operation performed (search_conversations)',
        },
        total_count: { type: 'number', description: 'Total number of matching conversations' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

export const intercomSearchConversationsV2Tool: ToolConfig<
  IntercomSearchConversationsParams,
  IntercomSearchConversationsV2Response
> = {
  ...searchConversationsBase,
  id: 'intercom_search_conversations_v2',
  name: 'Search Conversations in Intercom',
  description:
    'Search for conversations in Intercom using a query. Returns API-aligned fields only.',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'search_conversations')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversations: data.conversations ?? null,
        pages: data.pages ?? null,
        total_count: data.total_count ?? null,
        success: true,
      },
    }
  },

  outputs: {
    conversations: {
      type: 'array',
      description: 'Array of matching conversation objects',
      optional: true,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the conversation' },
          type: { type: 'string', description: 'Object type (conversation)' },
          title: { type: 'string', description: 'Title of the conversation', optional: true },
          created_at: {
            type: 'number',
            description: 'Unix timestamp when conversation was created',
          },
          updated_at: {
            type: 'number',
            description: 'Unix timestamp when conversation was last updated',
          },
          waiting_since: {
            type: 'number',
            description: 'Unix timestamp when waiting for reply',
            optional: true,
          },
          open: { type: 'boolean', description: 'Whether the conversation is open' },
          state: { type: 'string', description: 'State of the conversation' },
          read: { type: 'boolean', description: 'Whether the conversation has been read' },
          priority: { type: 'string', description: 'Priority of the conversation' },
          admin_assignee_id: {
            type: 'number',
            description: 'ID of assigned admin',
            optional: true,
          },
          team_assignee_id: { type: 'string', description: 'ID of assigned team', optional: true },
          tags: { type: 'object', description: 'Tags on the conversation' },
          source: { type: 'object', description: 'Source of the conversation' },
          contacts: { type: 'object', description: 'Contacts in the conversation' },
        },
      },
    },
    pages: {
      type: 'object',
      description: 'Pagination information',
      optional: true,
      properties: {
        type: { type: 'string', description: 'Pages type identifier' },
        page: { type: 'number', description: 'Current page number' },
        per_page: { type: 'number', description: 'Number of results per page' },
        total_pages: { type: 'number', description: 'Total number of pages' },
      },
    },
    total_count: {
      type: 'number',
      description: 'Total number of matching conversations',
      optional: true,
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
