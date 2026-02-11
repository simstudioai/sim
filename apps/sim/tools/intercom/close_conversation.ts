import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomCloseConversationParams {
  accessToken: string
  conversationId: string
  admin_id: string
  body?: string
}

export interface IntercomCloseConversationV2Response {
  success: boolean
  output: {
    conversation: any
    conversationId: string
    state: string
  }
}

const closeConversationBase = {
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
      description: 'The ID of the conversation to close',
    },
    admin_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the admin performing the action',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional closing message to add to the conversation',
    },
  },

  request: {
    url: (params: IntercomCloseConversationParams) =>
      buildIntercomUrl(`/conversations/${params.conversationId}/parts`),
    method: 'POST',
    headers: (params: IntercomCloseConversationParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomCloseConversationParams) => {
      const payload: any = {
        message_type: 'close',
        type: 'admin',
        admin_id: params.admin_id,
      }

      if (params.body) {
        payload.body = params.body
      }

      return payload
    },
  },
} satisfies Pick<ToolConfig<IntercomCloseConversationParams, any>, 'params' | 'request'>

export const intercomCloseConversationV2Tool: ToolConfig<
  IntercomCloseConversationParams,
  IntercomCloseConversationV2Response
> = {
  ...closeConversationBase,
  id: 'intercom_close_conversation_v2',
  name: 'Close Conversation in Intercom',
  description: 'Close a conversation in Intercom',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'close_conversation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversation: {
          id: data.id,
          type: data.type ?? 'conversation',
          state: data.state ?? 'closed',
          open: data.open ?? false,
          read: data.read ?? false,
          created_at: data.created_at ?? null,
          updated_at: data.updated_at ?? null,
        },
        conversationId: data.id,
        state: data.state ?? 'closed',
      },
    }
  },

  outputs: {
    conversation: {
      type: 'object',
      description: 'The closed conversation object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the conversation' },
        type: { type: 'string', description: 'Object type (conversation)' },
        state: { type: 'string', description: 'State of the conversation (closed)' },
        open: { type: 'boolean', description: 'Whether the conversation is open (false)' },
        read: { type: 'boolean', description: 'Whether the conversation has been read' },
        created_at: { type: 'number', description: 'Unix timestamp when conversation was created' },
        updated_at: {
          type: 'number',
          description: 'Unix timestamp when conversation was last updated',
        },
      },
    },
    conversationId: { type: 'string', description: 'ID of the closed conversation' },
    state: { type: 'string', description: 'State of the conversation (closed)' },
  },
}
