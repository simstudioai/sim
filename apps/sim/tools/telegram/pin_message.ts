import { ErrorExtractorId } from '@/tools/error-extractors'
import type { TelegramBooleanResponse, TelegramPinMessageParams } from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramPinMessageTool: ToolConfig<TelegramPinMessageParams, TelegramBooleanResponse> =
  {
    id: 'telegram_pin_message',
    name: 'Telegram Pin Message',
    description: 'Pin a message in a Telegram chat through the Telegram Bot API.',
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
        required: true,
        visibility: 'user-or-llm',
        description: 'Identifier of the message to pin',
      },
      disableNotification: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Pass true to pin silently without notifying chat members',
      },
    },

    request: {
      url: (params) => telegramApiUrl(params.botToken, 'pinChatMessage'),
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = {
          chat_id: params.chatId,
          message_id: params.messageId,
        }
        if (params.disableNotification !== undefined) {
          body.disable_notification = params.disableNotification
        }
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.ok) {
        const errorMessage = data.description || data.error || 'Failed to pin message'
        throw new Error(errorMessage)
      }

      return {
        success: true,
        output: {
          message: 'Message pinned successfully',
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
        description: 'Pin operation result',
        properties: {
          ok: { type: 'boolean', description: 'API response success status' },
          result: { type: 'boolean', description: 'Whether the message was pinned' },
        },
      },
    },
  }
