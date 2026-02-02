import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomGetConversationParams {
  accessToken: string
  conversationId: string
  display_as?: string
  include_translations?: boolean
}

export interface IntercomGetConversationResponse {
  success: boolean
  output: {
    conversation: any
    metadata: {
      operation: 'get_conversation'
    }
    success: boolean
  }
}

const getConversationBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Conversation ID to retrieve',
    },
    display_as: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to "plaintext" to retrieve messages in plain text',
    },
    include_translations: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When true, conversation parts will be translated to the detected language of the conversation',
    },
  },
  request: {
    url: (params: IntercomGetConversationParams) => {
      const url = buildIntercomUrl(`/conversations/${params.conversationId}`)
      const queryParams = new URLSearchParams()

      if (params.display_as) queryParams.append('display_as', params.display_as)
      if (params.include_translations !== undefined)
        queryParams.append('include_translations', String(params.include_translations))

      const queryString = queryParams.toString()
      return queryString ? `${url}?${queryString}` : url
    },
    method: 'GET',
    headers: (params: IntercomGetConversationParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomGetConversationParams, any>, 'params' | 'request'>

export const intercomGetConversationTool: ToolConfig<
  IntercomGetConversationParams,
  IntercomGetConversationResponse
> = {
  id: 'intercom_get_conversation',
  name: 'Get Conversation from Intercom',
  description: 'Retrieve a single conversation by ID from Intercom',
  version: '1.0.0',

  ...getConversationBase,

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'get_conversation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversation: data,
        metadata: {
          operation: 'get_conversation' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    conversation: {
      type: 'object',
      description: 'Conversation object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the conversation' },
        type: { type: 'string', description: 'Object type (conversation)' },
        title: { type: 'string', description: 'Title of the conversation', optional: true },
        created_at: { type: 'number', description: 'Unix timestamp when conversation was created' },
        updated_at: {
          type: 'number',
          description: 'Unix timestamp when conversation was last updated',
        },
        waiting_since: {
          type: 'number',
          description: 'Unix timestamp when waiting for reply',
          optional: true,
        },
        snoozed_until: {
          type: 'number',
          description: 'Unix timestamp when snooze ends',
          optional: true,
        },
        open: { type: 'boolean', description: 'Whether the conversation is open' },
        state: { type: 'string', description: 'State of the conversation' },
        read: { type: 'boolean', description: 'Whether the conversation has been read' },
        priority: { type: 'string', description: 'Priority of the conversation' },
        admin_assignee_id: { type: 'number', description: 'ID of assigned admin', optional: true },
        team_assignee_id: { type: 'string', description: 'ID of assigned team', optional: true },
        tags: { type: 'object', description: 'Tags on the conversation' },
        source: { type: 'object', description: 'Source of the conversation' },
        contacts: { type: 'object', description: 'Contacts in the conversation' },
        teammates: { type: 'object', description: 'Teammates in the conversation' },
        conversation_parts: { type: 'object', description: 'Parts of the conversation' },
        statistics: { type: 'object', description: 'Conversation statistics' },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (get_conversation)' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomGetConversationV2Response {
  success: boolean
  output: {
    conversation: any
    success: boolean
  }
}

export const intercomGetConversationV2Tool: ToolConfig<
  IntercomGetConversationParams,
  IntercomGetConversationV2Response
> = {
  ...getConversationBase,
  id: 'intercom_get_conversation_v2',
  name: 'Get Conversation from Intercom',
  description: 'Retrieve a single conversation by ID from Intercom',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'get_conversation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversation: data,
        success: true,
      },
    }
  },

  outputs: {
    conversation: {
      type: 'object',
      description: 'Conversation object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the conversation' },
        type: { type: 'string', description: 'Object type (conversation)' },
        title: { type: 'string', description: 'Title of the conversation', optional: true },
        created_at: { type: 'number', description: 'Unix timestamp when conversation was created' },
        updated_at: {
          type: 'number',
          description: 'Unix timestamp when conversation was last updated',
        },
        waiting_since: {
          type: 'number',
          description: 'Unix timestamp when waiting for reply',
          optional: true,
        },
        snoozed_until: {
          type: 'number',
          description: 'Unix timestamp when snooze ends',
          optional: true,
        },
        open: { type: 'boolean', description: 'Whether the conversation is open' },
        state: { type: 'string', description: 'State of the conversation' },
        read: { type: 'boolean', description: 'Whether the conversation has been read' },
        priority: { type: 'string', description: 'Priority of the conversation' },
        admin_assignee_id: { type: 'number', description: 'ID of assigned admin', optional: true },
        team_assignee_id: { type: 'string', description: 'ID of assigned team', optional: true },
        tags: { type: 'object', description: 'Tags on the conversation' },
        source: { type: 'object', description: 'Source of the conversation' },
        contacts: { type: 'object', description: 'Contacts in the conversation' },
        teammates: { type: 'object', description: 'Teammates in the conversation' },
        conversation_parts: { type: 'object', description: 'Parts of the conversation' },
        statistics: { type: 'object', description: 'Conversation statistics' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
