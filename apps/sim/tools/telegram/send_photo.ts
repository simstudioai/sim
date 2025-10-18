import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramPhoto,
  TelegramSendPhotoParams,
  TelegramSendPhotoResponse,
} from '@/tools/telegram/types'
import { convertMarkdownToHTML } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramSendPhotoTool: ToolConfig<TelegramSendPhotoParams, TelegramSendPhotoResponse> =
  {
    id: 'telegram_send_photo',
    name: 'Telegram Send Photo',
    description: 'Send photos to Telegram channels or users through the Telegram Bot API.',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.TELEGRAM_DESCRIPTION,

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
      photo: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Photo to send. Pass a file_id or HTTP URL',
      },
      caption: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Photo caption (optional)',
      },
    },

    request: {
      url: (params: TelegramSendPhotoParams) =>
        `https://api.telegram.org/bot${params.botToken}/sendPhoto`,
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params: TelegramSendPhotoParams) => {
        const body: Record<string, any> = {
          chat_id: params.chatId,
          photo: params.photo,
        }

        if (params.caption) {
          body.caption = convertMarkdownToHTML(params.caption)
          body.parse_mode = 'HTML'
        }

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.ok) {
        const errorMessage = data.description || data.error || 'Failed to send photo'
        throw new Error(errorMessage)
      }

      const result = data.result as TelegramPhoto

      return {
        success: true,
        output: {
          message: 'Photo sent successfully',
          data: result,
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
      data: {
        type: 'object',
        description: 'Telegram message data including optional photo(s)',
        properties: {
          message_id: {
            type: 'number',
            description: 'Unique Telegram message identifier',
          },
          from: {
            type: 'object',
            description: 'Chat information',
            properties: {
              id: { type: 'number', description: 'Chat ID' },
              is_bot: {
                type: 'boolean',
                description: 'Whether the chat is a bot or not',
              },
              first_name: {
                type: 'string',
                description: 'Chat username (if available)',
              },
              username: {
                type: 'string',
                description: 'Chat title (for groups and channels)',
              },
            },
          },
          chat: {
            type: 'object',
            description: 'Information about the bot that sent the message',
            properties: {
              id: { type: 'number', description: 'Bot user ID' },
              first_name: { type: 'string', description: 'Bot first name' },
              username: { type: 'string', description: 'Bot username' },
              type: {
                type: 'string',
                description: 'Chat type (private, group, supergroup, channel)',
              },
            },
          },
          date: {
            type: 'number',
            description: 'Unix timestamp when message was sent',
          },
          text: {
            type: 'string',
            description: 'Text content of the sent message (if applicable)',
          },
          photo: {
            type: 'array',
            description: 'List of photos included in the message',
            items: {
              type: 'object',
              properties: {
                file_id: {
                  type: 'string',
                  description: 'Unique file ID of the photo',
                },
                file_unique_id: {
                  type: 'string',
                  description: 'Unique identifier for this file across different bots',
                },
                file_size: {
                  type: 'number',
                  description: 'Size of the photo file in bytes',
                },
                width: { type: 'number', description: 'Photo width in pixels' },
                height: { type: 'number', description: 'Photo height in pixels' },
              },
            },
          },
        },
      },
    },
  }
