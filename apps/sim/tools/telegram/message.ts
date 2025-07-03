import type { ToolConfig } from '../types'
import type { TelegramMessageParams, TelegramMessageResponse } from './types'

// Helper function to convert basic markdown to HTML
function convertMarkdownToHTML(text: string): string {
  return (
    text
      // Bold: **text** or __text__ -> <b>text</b>
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/__(.*?)__/g, '<b>$1</b>')
      // Italic: *text* or _text_ -> <i>text</i>
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/_(.*?)_/g, '<i>$1</i>')
      // Code: `text` -> <code>text</code>
      .replace(/`(.*?)`/g, '<code>$1</code>')
      // Links: [text](url) -> <a href="url">text</a>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  )
}

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
      requiredForToolCall: true,
      description: 'Your Telegram Bot API Token',
    },
    chatId: {
      type: 'string',
      required: true,
      description: 'Target Telegram chat ID',
    },
    text: {
      type: 'string',
      required: true,
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
