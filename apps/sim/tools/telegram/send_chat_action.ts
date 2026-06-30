import { ErrorExtractorId } from '@/tools/error-extractors'
import type { TelegramBooleanResponse, TelegramSendChatActionParams } from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramSendChatActionTool: ToolConfig<
  TelegramSendChatActionParams,
  TelegramBooleanResponse
> = {
  id: 'telegram_send_chat_action',
  name: 'Telegram Send Chat Action',
  description:
    'Show a status action such as a typing indicator in a Telegram chat through the Telegram Bot API.',
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
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Type of action to broadcast (e.g. typing, upload_photo, record_video, upload_document, find_location)',
    },
  },

  request: {
    url: (params) => telegramApiUrl(params.botToken, 'sendChatAction'),
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      chat_id: params.chatId,
      action: params.action,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to send chat action'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        message: 'Chat action sent successfully',
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
      description: 'Chat action result',
      properties: {
        ok: { type: 'boolean', description: 'API response success status' },
        result: { type: 'boolean', description: 'Whether the action was broadcast' },
      },
    },
  },
}
