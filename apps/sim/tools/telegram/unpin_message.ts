import { ErrorExtractorId } from '@/tools/error-extractors'
import type { TelegramBooleanResponse, TelegramUnpinMessageParams } from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramUnpinMessageTool: ToolConfig<
  TelegramUnpinMessageParams,
  TelegramBooleanResponse
> = {
  id: 'telegram_unpin_message',
  name: 'Telegram Unpin Message',
  description:
    'Unpin a pinned message in a Telegram chat through the Telegram Bot API. Unpins the most recent pinned message when no message ID is given.',
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
      description: 'Telegram chat ID (numeric, can be negative for groups)',
    },
    messageId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identifier of the message to unpin (omit to unpin the most recent one)',
    },
  },

  request: {
    url: (params) => telegramApiUrl(params.botToken, 'unpinChatMessage'),
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        chat_id: params.chatId,
      }
      if (params.messageId !== undefined) body.message_id = params.messageId
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to unpin message'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        message: 'Message unpinned successfully',
        data: {
          ok: data.ok,
          result: data.result,
        },
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Unpin operation result',
      properties: {
        ok: { type: 'boolean', description: 'API response success status' },
        result: { type: 'boolean', description: 'Whether the message was unpinned' },
      },
    },
  },
}
