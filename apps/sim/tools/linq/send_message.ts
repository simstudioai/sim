import type { LinqSendMessageParams, LinqSendMessageResult } from '@/tools/linq/types'
import {
  buildMessageContent,
  extractLinqError,
  LINQ_API_BASE,
  linqHeaders,
} from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqSendMessageTool: ToolConfig<LinqSendMessageParams, LinqSendMessageResult> = {
  id: 'linq_send_message',
  name: 'Send Message',
  description: 'Send a message to an existing chat, with optional media, link, effect, or reply',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the chat',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Text content of the message. Optional, but at least one of text, media, attachment, or link is required',
    },
    mediaUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional publicly accessible HTTPS URL of an image, video, or file to attach',
    },
    attachmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional ID of a pre-uploaded attachment to send instead of a media URL',
    },
    linkUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional URL to send as a rich link preview. Linq requires a link to be its own message, so when set, text and media are ignored',
    },
    preferredService: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Preferred delivery service: iMessage, SMS, or RCS',
    },
    effectName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional iMessage effect name (e.g. confetti, fireworks, lasers)',
    },
    effectType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional effect type: screen or bubble',
    },
    replyToMessageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional message ID to reply to inline',
    },
    replyToPartIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional part index of the message being replied to',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional idempotency key to safely retry the request',
    },
  },

  request: {
    url: (params) => `${LINQ_API_BASE}/chats/${encodeURIComponent(params.chatId.trim())}/messages`,
    method: 'POST',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => ({ message: buildMessageContent(params) }),
  },

  transformResponse: async (response): Promise<LinqSendMessageResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to send message'),
        output: {
          chatId: '',
          messageId: '',
          deliveryStatus: null,
          sentAt: null,
          service: null,
          message: null,
        },
      }
    }

    const message = data.message ?? {}
    return {
      success: true,
      output: {
        chatId: data.chat_id ?? '',
        messageId: message.id ?? '',
        deliveryStatus: message.delivery_status ?? null,
        sentAt: message.sent_at ?? null,
        service: message.service ?? null,
        message,
      },
    }
  },

  outputs: {
    chatId: { type: 'string', description: 'ID of the chat the message was sent to' },
    messageId: { type: 'string', description: 'ID of the sent message' },
    deliveryStatus: {
      type: 'string',
      description: 'Delivery status (pending, queued, sent, delivered, failed)',
      optional: true,
    },
    sentAt: {
      type: 'string',
      description: 'ISO 8601 timestamp the message was sent',
      optional: true,
    },
    service: {
      type: 'string',
      description: 'Delivery service (iMessage, SMS, RCS)',
      optional: true,
    },
    message: { type: 'json', description: 'The full sent message object with parts' },
  },
}
