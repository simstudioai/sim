import type { LinqEditMessageParams, LinqMessageResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqEditMessageTool: ToolConfig<LinqEditMessageParams, LinqMessageResult> = {
  id: 'linq_edit_message',
  name: 'Edit Message',
  description:
    'Edit the text of a sent message (up to 5 times, within 15 minutes of sending; iMessage only)',
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
      description: 'The unique identifier of the message to edit',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New text content for the message part',
    },
    partIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the message part to edit (defaults to 0)',
    },
  },

  request: {
    url: (params) => `${LINQ_API_BASE}/messages/${encodeURIComponent(params.messageId.trim())}`,
    method: 'PATCH',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { text: params.text }
      if (typeof params.partIndex === 'number') body.part_index = params.partIndex
      return body
    },
  },

  transformResponse: async (response): Promise<LinqMessageResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to edit message'),
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
    parts: { type: 'json', description: 'Updated message parts with reactions' },
    message: { type: 'json', description: 'The full updated message object' },
  },
}
