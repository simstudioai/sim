import { createLogger } from '@/lib/logs/console/logger'
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
      visibility: 'user-only',
      description: 'Conversation ID to reply to',
    },
    message_type: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Message type: "comment" or "note"',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The text body of the reply',
    },
    admin_id: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the admin authoring the reply',
    },
    attachment_urls: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of image URLs (max 10)',
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
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated conversation with reply',
      properties: {
        conversation: { type: 'object', description: 'Updated conversation object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
