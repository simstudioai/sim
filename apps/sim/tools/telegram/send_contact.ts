import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramMessage,
  TelegramSendContactParams,
  TelegramSendMessageResponse,
} from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramSendContactTool: ToolConfig<
  TelegramSendContactParams,
  TelegramSendMessageResponse
> = {
  id: 'telegram_send_contact',
  name: 'Telegram Send Contact',
  description: 'Send a phone contact to a Telegram chat through the Telegram Bot API.',
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
    phoneNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Contact's phone number",
    },
    firstName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Contact's first name",
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Contact's last name",
    },
    vcard: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional data about the contact in the form of a vCard',
    },
  },

  request: {
    url: (params) => telegramApiUrl(params.botToken, 'sendContact'),
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        chat_id: params.chatId,
        phone_number: params.phoneNumber,
        first_name: params.firstName,
      }
      if (params.lastName) body.last_name = params.lastName
      if (params.vcard) body.vcard = params.vcard
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to send contact'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        message: 'Contact sent successfully',
        data: data.result as TelegramMessage,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Telegram message data for the sent contact',
      properties: {
        message_id: { type: 'number', description: 'Unique Telegram message identifier' },
        date: { type: 'number', description: 'Unix timestamp when message was sent' },
      },
    },
  },
}
