import type { LinqGetMessageParams, LinqMessageResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqGetMessageTool: ToolConfig<LinqGetMessageParams, LinqMessageResult> = {
  id: 'linq_get_message',
  name: 'Get Message',
  description: 'Retrieve a single message by ID, including parts, reactions, and delivery status',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the message',
    },
  },

  request: {
    url: (params) => `${LINQ_API_BASE}/messages/${encodeURIComponent(params.messageId.trim())}`,
    method: 'GET',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqMessageResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to get message'),
        output: {
          id: '',
          chatId: '',
          isFromMe: null,
          isDelivered: null,
          isRead: null,
          service: null,
          createdAt: null,
          updatedAt: null,
          sentAt: null,
          parts: [],
          message: {},
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        chatId: data.chat_id ?? '',
        isFromMe: data.is_from_me ?? null,
        isDelivered: data.is_delivered ?? null,
        isRead: data.is_read ?? null,
        service: data.service ?? null,
        createdAt: data.created_at ?? null,
        updatedAt: data.updated_at ?? null,
        sentAt: data.sent_at ?? null,
        parts: data.parts ?? [],
        message: data,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Message ID' },
    chatId: { type: 'string', description: 'ID of the chat the message belongs to' },
    isFromMe: {
      type: 'boolean',
      description: 'Whether the message was sent by you',
      optional: true,
    },
    isDelivered: {
      type: 'boolean',
      description: 'Whether the message was delivered',
      optional: true,
    },
    isRead: { type: 'boolean', description: 'Whether the message was read', optional: true },
    service: {
      type: 'string',
      description: 'Delivery service (iMessage, SMS, RCS)',
      optional: true,
    },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', optional: true },
    updatedAt: { type: 'string', description: 'ISO 8601 update timestamp', optional: true },
    sentAt: { type: 'string', description: 'ISO 8601 sent timestamp', optional: true },
    parts: { type: 'json', description: 'Message parts (text, media, link) with reactions' },
    message: { type: 'json', description: 'The full message object' },
  },
}
