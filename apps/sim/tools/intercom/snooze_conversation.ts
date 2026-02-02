import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomSnoozeConversationParams {
  accessToken: string
  conversationId: string
  admin_id: string
  snoozed_until: number
}

export interface IntercomSnoozeConversationV2Response {
  success: boolean
  output: {
    conversation: any
    conversationId: string
    state: string
    snoozed_until: number | null
  }
}

const snoozeConversationBase = {
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
      description: 'The ID of the conversation to snooze',
    },
    admin_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the admin performing the action',
    },
    snoozed_until: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unix timestamp for when the conversation should reopen',
    },
  },

  request: {
    url: (params: IntercomSnoozeConversationParams) =>
      buildIntercomUrl(`/conversations/${params.conversationId}/reply`),
    method: 'POST',
    headers: (params: IntercomSnoozeConversationParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomSnoozeConversationParams) => ({
      message_type: 'snoozed',
      admin_id: params.admin_id,
      snoozed_until: params.snoozed_until,
    }),
  },
} satisfies Pick<ToolConfig<IntercomSnoozeConversationParams, any>, 'params' | 'request'>

export const intercomSnoozeConversationV2Tool: ToolConfig<
  IntercomSnoozeConversationParams,
  IntercomSnoozeConversationV2Response
> = {
  ...snoozeConversationBase,
  id: 'intercom_snooze_conversation_v2',
  name: 'Snooze Conversation in Intercom',
  description: 'Snooze a conversation to reopen at a future time',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'snooze_conversation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversation: data,
        conversationId: data.id,
        state: data.state ?? 'snoozed',
        snoozed_until: data.snoozed_until ?? null,
      },
    }
  },

  outputs: {
    conversation: {
      type: 'object',
      description: 'The snoozed conversation object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the conversation' },
        type: { type: 'string', description: 'Object type (conversation)' },
        state: { type: 'string', description: 'State of the conversation (snoozed)' },
        open: { type: 'boolean', description: 'Whether the conversation is open' },
        snoozed_until: {
          type: 'number',
          description: 'Unix timestamp when conversation will reopen',
          optional: true,
        },
        created_at: { type: 'number', description: 'Unix timestamp when conversation was created' },
        updated_at: {
          type: 'number',
          description: 'Unix timestamp when conversation was last updated',
        },
      },
    },
    conversationId: { type: 'string', description: 'ID of the snoozed conversation' },
    state: { type: 'string', description: 'State of the conversation (snoozed)' },
    snoozed_until: {
      type: 'number',
      description: 'Unix timestamp when conversation will reopen',
      optional: true,
    },
  },
}
