import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomOpenConversationParams {
  accessToken: string
  conversationId: string
  admin_id: string
}

export interface IntercomOpenConversationV2Response {
  success: boolean
  output: {
    conversation: any
    conversationId: string
    state: string
  }
}

const openConversationBase = {
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
      description: 'The ID of the conversation to open',
    },
    admin_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the admin performing the action',
    },
  },

  request: {
    url: (params: IntercomOpenConversationParams) =>
      buildIntercomUrl(`/conversations/${params.conversationId}/parts`),
    method: 'POST',
    headers: (params: IntercomOpenConversationParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomOpenConversationParams) => ({
      message_type: 'open',
      type: 'admin',
      admin_id: params.admin_id,
    }),
  },
} satisfies Pick<ToolConfig<IntercomOpenConversationParams, any>, 'params' | 'request'>

export const intercomOpenConversationV2Tool: ToolConfig<
  IntercomOpenConversationParams,
  IntercomOpenConversationV2Response
> = {
  ...openConversationBase,
  id: 'intercom_open_conversation_v2',
  name: 'Open Conversation in Intercom',
  description: 'Open a closed or snoozed conversation in Intercom',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'open_conversation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversation: {
          id: data.id,
          type: data.type ?? 'conversation',
          state: data.state ?? 'open',
          open: data.open ?? true,
          read: data.read ?? false,
          created_at: data.created_at ?? null,
          updated_at: data.updated_at ?? null,
        },
        conversationId: data.id,
        state: data.state ?? 'open',
      },
    }
  },

  outputs: {
    conversation: {
      type: 'object',
      description: 'The opened conversation object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the conversation' },
        type: { type: 'string', description: 'Object type (conversation)' },
        state: { type: 'string', description: 'State of the conversation (open)' },
        open: { type: 'boolean', description: 'Whether the conversation is open (true)' },
        read: { type: 'boolean', description: 'Whether the conversation has been read' },
        created_at: { type: 'number', description: 'Unix timestamp when conversation was created' },
        updated_at: {
          type: 'number',
          description: 'Unix timestamp when conversation was last updated',
        },
      },
    },
    conversationId: { type: 'string', description: 'ID of the opened conversation' },
    state: { type: 'string', description: 'State of the conversation (open)' },
  },
}
