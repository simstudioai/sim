import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramForwardMessageParams,
  TelegramMessage,
  TelegramSendMessageResponse,
} from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramForwardMessageTool: ToolConfig<
  TelegramForwardMessageParams,
  TelegramSendMessageResponse
> = {
  id: 'telegram_forward_message',
  name: 'Telegram Forward Message',
  description: 'Forward a message from one Telegram chat to another through the Telegram Bot API.',
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
      visibility: 'user-or-llm',
      description: 'Destination chat ID (numeric, can be negative for groups)',
    },
    fromChatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source chat ID the original message belongs to',
    },
    messageId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier of the message to forward in the source chat',
    },
  },

  request: {
    url: (params) => telegramApiUrl(params.botToken, 'forwardMessage'),
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      chat_id: params.chatId,
      from_chat_id: params.fromChatId,
      message_id: params.messageId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to forward message'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        message: 'Message forwarded successfully',
        data: data.result as TelegramMessage,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Forwarded Telegram message data',
      properties: {
        message_id: { type: 'number', description: 'Identifier of the forwarded message' },
        date: { type: 'number', description: 'Unix timestamp when message was sent' },
        text: { type: 'string', description: 'Text content of the forwarded message' },
      },
    },
  },
}
