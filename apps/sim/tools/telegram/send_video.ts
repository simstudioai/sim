import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramMedia,
  TelegramSendMediaResponse,
  TelegramSendVideoParams,
} from '@/tools/telegram/types'
import { convertMarkdownToHTML } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramSendVideoTool: ToolConfig<TelegramSendVideoParams, TelegramSendMediaResponse> =
  {
    id: 'telegram_send_video',
    name: 'Telegram Send Video',
    description: 'Send videos to Telegram channels or users through the Telegram Bot API.',
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
      video: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Video to send. Pass a file_id or HTTP URL',
      },
      caption: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Video caption (optional)',
      },
    },

    request: {
      url: (params: TelegramSendVideoParams) =>
        `https://api.telegram.org/bot${params.botToken}/sendVideo`,
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params: TelegramSendVideoParams) => {
        const body: Record<string, any> = {
          chat_id: params.chatId,
          video: params.video,
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
        const errorMessage = data.description || data.error || 'Failed to send video'
        throw new Error(errorMessage)
      }

      const result = data.result as TelegramMedia

      return {
        success: true,
        output: {
          message: 'Video sent successfully',
          data: result,
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
      data: {
        type: 'object',
        description: 'Telegram message data including optional media',
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
          text: {
            type: 'string',
            description: 'Text content of the sent message (if applicable)',
          },
          format: {
            type: 'object',
            description: 'Media format information (for videos, GIFs, etc.)',
            properties: {
              file_name: { type: 'string', description: 'Media file name' },
              mime_type: { type: 'string', description: 'Media MIME type' },
              duration: {
                type: 'number',
                description: 'Duration of media in seconds',
              },
              width: { type: 'number', description: 'Media width in pixels' },
              height: { type: 'number', description: 'Media height in pixels' },
              thumbnail: {
                type: 'object',
                description: 'Thumbnail image details',
                properties: {
                  file_id: { type: 'string', description: 'Thumbnail file ID' },
                  file_unique_id: {
                    type: 'string',
                    description: 'Unique thumbnail file identifier',
                  },
                  file_size: {
                    type: 'number',
                    description: 'Thumbnail file size in bytes',
                  },
                  width: {
                    type: 'number',
                    description: 'Thumbnail width in pixels',
                  },
                  height: {
                    type: 'number',
                    description: 'Thumbnail height in pixels',
                  },
                },
              },
              thumb: {
                type: 'object',
                description: 'Secondary thumbnail details (duplicate of thumbnail)',
                properties: {
                  file_id: { type: 'string', description: 'Thumbnail file ID' },
                  file_unique_id: {
                    type: 'string',
                    description: 'Unique thumbnail file identifier',
                  },
                  file_size: {
                    type: 'number',
                    description: 'Thumbnail file size in bytes',
                  },
                  width: {
                    type: 'number',
                    description: 'Thumbnail width in pixels',
                  },
                  height: {
                    type: 'number',
                    description: 'Thumbnail height in pixels',
                  },
                },
              },
              file_id: { type: 'string', description: 'Media file ID' },
              file_unique_id: {
                type: 'string',
                description: 'Unique media file identifier',
              },
              file_size: {
                type: 'number',
                description: 'Size of media file in bytes',
              },
            },
          },
          document: {
            type: 'object',
            description: 'Document file details if the message contains a document',
            properties: {
              file_name: { type: 'string', description: 'Document file name' },
              mime_type: { type: 'string', description: 'Document MIME type' },
              thumbnail: {
                type: 'object',
                description: 'Document thumbnail information',
                properties: {
                  file_id: { type: 'string', description: 'Thumbnail file ID' },
                  file_unique_id: {
                    type: 'string',
                    description: 'Unique thumbnail file identifier',
                  },
                  file_size: {
                    type: 'number',
                    description: 'Thumbnail file size in bytes',
                  },
                  width: {
                    type: 'number',
                    description: 'Thumbnail width in pixels',
                  },
                  height: {
                    type: 'number',
                    description: 'Thumbnail height in pixels',
                  },
                },
              },
              thumb: {
                type: 'object',
                description: 'Duplicate thumbnail info (used for compatibility)',
                properties: {
                  file_id: { type: 'string', description: 'Thumbnail file ID' },
                  file_unique_id: {
                    type: 'string',
                    description: 'Unique thumbnail file identifier',
                  },
                  file_size: {
                    type: 'number',
                    description: 'Thumbnail file size in bytes',
                  },
                  width: {
                    type: 'number',
                    description: 'Thumbnail width in pixels',
                  },
                  height: {
                    type: 'number',
                    description: 'Thumbnail height in pixels',
                  },
                },
              },
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
