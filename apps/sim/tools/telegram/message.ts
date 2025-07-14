import type { ToolConfig } from '../types'
import type { TelegramMessageParams, TelegramMessageResponse } from './types'
import { convertMarkdownToHTML } from './utils'

export const telegramMessageTool: ToolConfig<TelegramMessageParams, TelegramMessageResponse> = {
  id: 'telegram_message',
  name: 'Telegram Message',
  description:
    'Send messages to Telegram channels or users through the Telegram Bot API. Enables direct communication and notifications with message tracking and chat confirmation.',
  version: '1.0.0',

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
    url: (params: TelegramMessageParams) =>
      `https://api.telegram.org/bot${params.botToken}/sendMessage`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TelegramMessageParams) => ({
      chat_id: params.chatId,
      text: convertMarkdownToHTML(params.text),
      parse_mode: 'HTML',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.ok) {
      throw new Error(data.description || 'Telegram API error')
    }
    return {
      success: true,
      output: data.result,
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Telegram message failed'
    return message
  },
}
