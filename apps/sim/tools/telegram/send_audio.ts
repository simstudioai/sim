import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramAudio,
  TelegramSendAudioParams,
  TelegramSendAudioResponse,
} from '@/tools/telegram/types'
import { convertMarkdownToHTML } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramSendAudioTool: ToolConfig<TelegramSendAudioParams, TelegramSendAudioResponse> =
  {
    id: 'telegram_send_audio',
    name: 'Telegram Send Audio',
    description: 'Send audio files to Telegram channels or users through the Telegram Bot API.',
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
      audio: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Audio file to send. Pass a file_id or HTTP URL',
      },
      caption: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Audio caption (optional)',
      },
    },

    request: {
      url: (params: TelegramSendAudioParams) =>
        `https://api.telegram.org/bot${params.botToken}/sendAudio`,
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params: TelegramSendAudioParams) => {
        const body: Record<string, any> = {
          chat_id: params.chatId,
          audio: params.audio,
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
        const errorMessage = data.description || data.error || 'Failed to send audio'
        throw new Error(errorMessage)
      }

      const result = data.result as TelegramAudio

      return {
        success: true,
        output: {
          message: 'Audio sent successfully',
          data: result,
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
      data: {
        type: 'object',
        description: 'Telegram message data including voice/audio information',
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
            description: 'Information about the chat where the message was sent',
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
          audio: {
            type: 'object',
            description: 'Audio file details',
            properties: {
              duration: {
                type: 'number',
                description: 'Duration of the audio in seconds',
              },
              performer: {
                type: 'string',
                description: 'Performer of the audio',
              },
              title: {
                type: 'string',
                description: 'Title of the audio',
              },
              file_name: {
                type: 'string',
                description: 'Original filename of the audio',
              },
              mime_type: {
                type: 'string',
                description: 'MIME type of the audio file',
              },
              file_id: {
                type: 'string',
                description: 'Unique file identifier for this audio',
              },
              file_unique_id: {
                type: 'string',
                description: 'Unique identifier across different bots for this file',
              },
              file_size: {
                type: 'number',
                description: 'Size of the audio file in bytes',
              },
            },
          },
        },
      },
    },
  }
