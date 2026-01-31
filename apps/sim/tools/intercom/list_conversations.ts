import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomListConversationsParams {
  accessToken: string
  per_page?: number
  starting_after?: string
  sort?: string
  order?: 'asc' | 'desc'
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

const listConversationsBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
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
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by (e.g., "waiting_since", "updated_at", "created_at")',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: "asc" (ascending) or "desc" (descending)',
    },
  },
  request: {
    url: (params: IntercomListConversationsParams) => {
      const url = buildIntercomUrl('/conversations')
      const queryParams = new URLSearchParams()

      if (params.per_page) queryParams.append('per_page', params.per_page.toString())
      if (params.starting_after) queryParams.append('starting_after', params.starting_after)
      if (params.sort) queryParams.append('sort', params.sort)
      if (params.order) queryParams.append('order', params.order)

      const queryString = queryParams.toString()
      return queryString ? `${url}?${queryString}` : url
    },
    method: 'GET',
    headers: (params: IntercomListConversationsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomListConversationsParams, any>, 'params' | 'request'>

export const intercomListConversationsTool: ToolConfig<
  IntercomListConversationsParams,
  IntercomListConversationsResponse
> = {
  id: 'intercom_list_conversations',
  name: 'List Conversations from Intercom',
  description: 'List all conversations from Intercom with pagination support',
  version: '1.0.0',

  ...listConversationsBase,

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
    conversations: {
      type: 'array',
      description: 'Array of conversation objects',
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
        operation: { type: 'string', description: 'The operation performed (list_conversations)' },
        total_count: { type: 'number', description: 'Total number of conversations' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomListConversationsV2Response {
  success: boolean
  output: {
    conversations: any[]
    pages?: any
    total_count?: number
    success: boolean
  }
}

export const intercomListConversationsV2Tool: ToolConfig<
  IntercomListConversationsParams,
  IntercomListConversationsV2Response
> = {
  ...listConversationsBase,
  id: 'intercom_list_conversations_v2',
  name: 'List Conversations from Intercom',
  description: 'List all conversations from Intercom with pagination support',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'list_conversations')
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
      description: 'Array of conversation objects',
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
    total_count: { type: 'number', description: 'Total number of conversations', optional: true },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
