import type { LinqCreateChatParams, LinqCreateChatResult } from '@/tools/linq/types'
import {
  buildMessageContent,
  extractLinqError,
  LINQ_API_BASE,
  linqHeaders,
} from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqCreateChatTool: ToolConfig<LinqCreateChatParams, LinqCreateChatResult> = {
  id: 'linq_create_chat',
  name: 'Create Chat',
  description: 'Start a new iMessage, SMS, or RCS chat and send the first message',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    from: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sender phone number in E.164 format (e.g. +14155551234)',
    },
    to: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient handles (phone numbers in E.164 format or email addresses)',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Text content of the first message. Optional, but at least one of text, media, attachment, or link is required',
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
    url: `${LINQ_API_BASE}/chats`,
    method: 'POST',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => {
      if (params.linkUrl) {
        throw new Error(
          'The first message of a new chat cannot be a link (Linq rejects it). Create the chat first, then send a link in a follow-up message.'
        )
      }
      return {
        from: params.from,
        to: params.to,
        message: buildMessageContent(params),
      }
    },
  },

  transformResponse: async (response): Promise<LinqCreateChatResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to create chat'),
        output: {
          chatId: '',
          displayName: '',
          isGroup: false,
          service: null,
          handles: [],
          healthStatus: null,
          message: null,
        },
      }
    }

    const chat = data.chat ?? {}
    return {
      success: true,
      output: {
        chatId: chat.id ?? '',
        displayName: chat.display_name ?? '',
        isGroup: chat.is_group ?? false,
        service: chat.service ?? null,
        handles: chat.handles ?? [],
        healthStatus: chat.health_status ?? null,
        message: chat.message ?? null,
      },
    }
  },

  outputs: {
    chatId: { type: 'string', description: 'ID of the created chat' },
    displayName: { type: 'string', description: 'Display name of the chat' },
    isGroup: { type: 'boolean', description: 'Whether the chat is a group chat' },
    service: { type: 'string', description: 'Delivery service used (iMessage, SMS, RCS)' },
    handles: { type: 'json', description: 'Participant handles in the chat' },
    healthStatus: { type: 'json', description: 'Messaging line health status', optional: true },
    message: { type: 'json', description: 'The sent message object with parts and delivery info' },
  },
}
