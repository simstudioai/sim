import { ErrorExtractorId } from '@/tools/error-extractors'
import type { TelegramCopyMessageParams, TelegramCopyMessageResponse } from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramCopyMessageTool: ToolConfig<
  TelegramCopyMessageParams,
  TelegramCopyMessageResponse
> = {
  id: 'telegram_copy_message',
  name: 'Telegram Copy Message',
  description:
    'Copy a message to another Telegram chat without a forward header through the Telegram Bot API.',
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
      description: 'Identifier of the message to copy in the source chat',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New caption for the copied media (keeps the original if omitted)',
    },
  },

  request: {
    url: (params) => telegramApiUrl(params.botToken, 'copyMessage'),
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        chat_id: params.chatId,
        from_chat_id: params.fromChatId,
        message_id: params.messageId,
      }
      if (params.caption) body.caption = params.caption
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to copy message'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        message: 'Message copied successfully',
        data: {
          message_id: data.result?.message_id,
        },
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Copied message identifier',
      properties: {
        message_id: { type: 'number', description: 'Identifier of the new copied message' },
      },
    },
  },
}
