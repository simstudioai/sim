import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomReplyConversation')

export interface IntercomReplyConversationParams {
  accessToken: string
  conversationId: string
  message_type: string
  body: string
  admin_id?: string
  attachment_urls?: string
  created_at?: number
}

export interface IntercomReplyConversationResponse {
  success: boolean
  output: {
    conversation: any
    metadata: {
      operation: 'reply_conversation'
      conversationId: string
    }
    success: boolean
  }
}

export const intercomReplyConversationTool: ToolConfig<
  IntercomReplyConversationParams,
  IntercomReplyConversationResponse
> = {
  id: 'intercom_reply_conversation',
  name: 'Reply to Conversation in Intercom',
  description: 'Reply to a conversation as an admin in Intercom',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    conversationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Conversation ID to reply to',
    },
    message_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message type: "comment" or "note"',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text body of the reply',
    },
    admin_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the admin authoring the reply. If not provided, a default admin (Operator/Fin) will be used.',
    },
    attachment_urls: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of image URLs (max 10)',
    },
    created_at: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unix timestamp for when the reply was created. If not provided, current time is used.',
    },
  },

  request: {
    url: (params) => buildIntercomUrl(`/conversations/${params.conversationId}/reply`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params) => {
      const reply: any = {
        message_type: params.message_type,
        type: 'admin',
        body: params.body,
      }

      if (params.admin_id) reply.admin_id = params.admin_id

      if (params.attachment_urls) {
        reply.attachment_urls = params.attachment_urls
          .split(',')
          .map((url) => url.trim())
          .slice(0, 10)
      }

      if (params.created_at) reply.created_at = params.created_at

      return reply
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'reply_conversation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        conversation: data,
        metadata: {
          operation: 'reply_conversation' as const,
          conversationId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    conversation: {
      type: 'object',
      description: 'Updated conversation object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the conversation' },
        type: { type: 'string', description: 'Object type (conversation)' },
        title: { type: 'string', description: 'Title of the conversation' },
        created_at: { type: 'number', description: 'Unix timestamp when conversation was created' },
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
        conversation_parts: { type: 'object', description: 'Parts of the conversation' },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (reply_conversation)' },
        conversationId: { type: 'string', description: 'ID of the conversation' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
