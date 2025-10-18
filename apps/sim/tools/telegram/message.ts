import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramMessage,
  TelegramSendMessageParams,
  TelegramSendMessageResponse,
} from '@/tools/telegram/types'
import { convertMarkdownToHTML } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramMessageTool: ToolConfig<
  TelegramSendMessageParams,
  TelegramSendMessageResponse
> = {
  id: 'telegram_message',
  name: 'Telegram Send Message',
  description:
    'Send messages to Telegram channels or users through the Telegram Bot API. Enables direct communication and notifications with message tracking and chat confirmation.',
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
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message text to send',
    },
  },

  request: {
    url: (params: TelegramSendMessageParams) =>
      `https://api.telegram.org/bot${params.botToken}/sendMessage`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TelegramSendMessageParams) => ({
      chat_id: params.chatId,
      text: convertMarkdownToHTML(params.text),
      parse_mode: 'HTML',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to send message'
      throw new Error(errorMessage)
    }

    const result = data.result as TelegramMessage

    return {
      success: true,
      output: {
        message: 'Message sent successfully',
        data: result,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Telegram message data',
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
              description: 'chat type private or channel',
            },
          },
        },
        date: {
          type: 'number',
          description: 'Unix timestamp when message was sent',
        },
        text: {
          type: 'string',
          description: 'Text content of the sent message',
        },
      },
    },
  },
}
