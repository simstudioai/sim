import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramMessage,
  TelegramSendLocationParams,
  TelegramSendMessageResponse,
} from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramSendLocationTool: ToolConfig<
  TelegramSendLocationParams,
  TelegramSendMessageResponse
> = {
  id: 'telegram_send_location',
  name: 'Telegram Send Location',
  description: 'Send a point on the map to a Telegram chat through the Telegram Bot API.',
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
    latitude: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Latitude of the location',
    },
    longitude: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Longitude of the location',
    },
  },

  request: {
    url: (params) => telegramApiUrl(params.botToken, 'sendLocation'),
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      chat_id: params.chatId,
      latitude: params.latitude,
      longitude: params.longitude,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to send location'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        message: 'Location sent successfully',
        data: data.result as TelegramMessage,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Telegram message data for the sent location',
      properties: {
        message_id: { type: 'number', description: 'Unique Telegram message identifier' },
        date: { type: 'number', description: 'Unix timestamp when message was sent' },
      },
    },
  },
}
