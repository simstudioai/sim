import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomAssignConversationParams {
  accessToken: string
  conversationId: string
  admin_id: string
  assignee_id: string
  body?: string
}

export interface IntercomAssignConversationV2Response {
  success: boolean
  output: {
    conversation: any
    conversationId: string
    admin_assignee_id: number | null
    team_assignee_id: string | null
  }
}

const assignConversationBase = {
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
      description: 'The ID of the conversation to assign',
    },
    admin_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the admin performing the assignment',
    },
    assignee_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the admin or team to assign the conversation to. Set to "0" to unassign.',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional message to add when assigning (e.g., "Passing to the support team")',
    },
  },

  request: {
    url: (params: IntercomAssignConversationParams) =>
      buildIntercomUrl(`/conversations/${params.conversationId}/parts`),
    method: 'POST',
    headers: (params: IntercomAssignConversationParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomAssignConversationParams) => {
      const payload: any = {
        message_type: 'assignment',
        type: 'admin',
        admin_id: params.admin_id,
        assignee_id: params.assignee_id,
      }

      if (params.body) {
        payload.body = params.body
      }

      return payload
    },
  },
} satisfies Pick<ToolConfig<IntercomAssignConversationParams, any>, 'params' | 'request'>

export const intercomAssignConversationV2Tool: ToolConfig<
  IntercomAssignConversationParams,
  IntercomAssignConversationV2Response
> = {
  ...assignConversationBase,
  id: 'intercom_assign_conversation_v2',
  name: 'Assign Conversation in Intercom',
  description: 'Assign a conversation to an admin or team in Intercom',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'assign_conversation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversation: data,
        conversationId: data.id,
        admin_assignee_id: data.admin_assignee_id ?? null,
        team_assignee_id: data.team_assignee_id ?? null,
      },
    }
  },

  outputs: {
    conversation: {
      type: 'object',
      description: 'The assigned conversation object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the conversation' },
        type: { type: 'string', description: 'Object type (conversation)' },
        state: { type: 'string', description: 'State of the conversation' },
        open: { type: 'boolean', description: 'Whether the conversation is open' },
        admin_assignee_id: {
          type: 'number',
          description: 'ID of the assigned admin',
          optional: true,
        },
        team_assignee_id: {
          type: 'string',
          description: 'ID of the assigned team',
          optional: true,
        },
        created_at: { type: 'number', description: 'Unix timestamp when conversation was created' },
        updated_at: {
          type: 'number',
          description: 'Unix timestamp when conversation was last updated',
        },
      },
    },
    conversationId: { type: 'string', description: 'ID of the assigned conversation' },
    admin_assignee_id: {
      type: 'number',
      description: 'ID of the assigned admin',
      optional: true,
    },
    team_assignee_id: { type: 'string', description: 'ID of the assigned team', optional: true },
  },
}
