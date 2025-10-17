import type {
  TelegramSendDocumentParams,
  TelegramSendDocumentResponse,
} from '@/tools/telegram/types'
import type { ToolConfig } from '@/tools/types'

export const telegramSendDocumentTool: ToolConfig<
  TelegramSendDocumentParams,
  TelegramSendDocumentResponse
> = {
  id: 'telegram_send_document',
  name: 'Telegram Send Document',
  description:
    'Send documents (PDF, ZIP, DOC, etc.) to Telegram channels or users through the Telegram Bot API.',
  version: '1.0.0',

  params: {
    botToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Telegram Bot API Token',
    },
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Target Telegram chat ID',
    },
    files: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Document file to send (PDF, ZIP, DOC, etc.). Max size: 50MB',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document caption (optional)',
    },
  },

  request: {
    url: '/api/tools/telegram/send-document',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TelegramSendDocumentParams) => {
      return {
        botToken: params.botToken,
        chatId: params.chatId,
        files: params.files || null,
        caption: params.caption,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to send Telegram document')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Telegram message data including document',
      properties: {
        message_id: {
          type: 'number',
          description: 'Unique Telegram message identifier',
        },
        from: {
          type: 'object',
          description: 'Information about the sender',
          properties: {
            id: { type: 'number', description: 'Sender ID' },
            is_bot: {
              type: 'boolean',
              description: 'Whether the chat is a bot or not',
            },
            first_name: {
              type: 'string',
              description: "Sender's first name (if available)",
            },
            username: {
              type: 'string',
              description: "Sender's username (if available)",
            },
          },
        },
        chat: {
          type: 'object',
          description: 'Information about the chat where message was sent',
          properties: {
            id: { type: 'number', description: 'Chat ID' },
            first_name: {
              type: 'string',
              description: 'Chat first name (if private chat)',
            },
            username: {
              type: 'string',
              description: 'Chat username (for private or channels)',
            },
            type: {
              type: 'string',
              description: 'Type of chat (private, group, supergroup, or channel)',
            },
          },
        },
        date: {
          type: 'number',
          description: 'Unix timestamp when the message was sent',
        },
        document: {
          type: 'object',
          description: 'Document file details',
          properties: {
            file_name: { type: 'string', description: 'Document file name' },
            mime_type: { type: 'string', description: 'Document MIME type' },
            file_id: { type: 'string', description: 'Document file ID' },
            file_unique_id: {
              type: 'string',
              description: 'Unique document file identifier',
            },
            file_size: {
              type: 'number',
              description: 'Size of document file in bytes',
            },
          },
        },
      },
    },
  },
}
