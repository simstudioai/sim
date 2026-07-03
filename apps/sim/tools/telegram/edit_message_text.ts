import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramEditMessageTextParams,
  TelegramMessage,
  TelegramSendMessageResponse,
} from '@/tools/telegram/types'
import { convertMarkdownToHTML, telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramEditMessageTextTool: ToolConfig<
  TelegramEditMessageTextParams,
  TelegramSendMessageResponse
> = {
  id: 'telegram_edit_message_text',
  name: 'Telegram Edit Message Text',
  description:
    'Edit the text of an existing message in a Telegram chat or channel through the Telegram Bot API.',
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
      description: 'Identifier of the message to edit',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New text of the message',
    },
  },

  request: {
    url: (params) => telegramApiUrl(params.botToken, 'editMessageText'),
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      chat_id: params.chatId,
      message_id: params.messageId,
      text: convertMarkdownToHTML(params.text),
      parse_mode: 'HTML',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to edit message'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        message: 'Message edited successfully',
        data: data.result as TelegramMessage,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Edited Telegram message data',
      properties: {
        message_id: { type: 'number', description: 'Unique Telegram message identifier' },
        date: { type: 'number', description: 'Unix timestamp when message was sent' },
        text: { type: 'string', description: 'Text content of the edited message' },
      },
    },
  },
}
