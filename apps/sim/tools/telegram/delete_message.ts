import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramDeleteMessageParams,
  TelegramDeleteMessageResponse,
} from '@/tools/telegram/types'
import type { ToolConfig } from '@/tools/types'

export const telegramDeleteMessageTool: ToolConfig<
  TelegramDeleteMessageParams,
  TelegramDeleteMessageResponse
> = {
  id: 'telegram_delete_message',
  name: 'Telegram Delete Message',
  description:
    'Delete messages in Telegram channels or chats through the Telegram Bot API. Requires the message ID of the message to delete.',
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
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message ID to delete',
    },
  },

  request: {
    url: (params: TelegramDeleteMessageParams) =>
      `https://api.telegram.org/bot${params.botToken}/deleteMessage`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TelegramDeleteMessageParams) => ({
      chat_id: params.chatId,
      message_id: params.messageId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to delete message'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        message: 'Message deleted successfully',
        data: {
          ok: data.ok,
          deleted: data.result,
        },
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Delete operation result',
      properties: {
        ok: { type: 'boolean', description: 'API response success status' },
        deleted: {
          type: 'boolean',
          description: 'Whether the message was successfully deleted',
        },
      },
    },
  },
}
