import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramMessage,
  TelegramSendMessageResponse,
  TelegramSendPollParams,
} from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Normalize poll options into a trimmed string array. Accepts an array, a JSON
 * array string, or a newline-separated string (the `json`-typed param can arrive
 * in any of these forms from block inputs or agent tool-calls).
 */
function normalizePollOptions(value: unknown): string[] {
  let items: unknown[] = []
  if (Array.isArray(value)) {
    items = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    try {
      const parsed = JSON.parse(trimmed)
      items = Array.isArray(parsed) ? parsed : trimmed.split('\n')
    } catch {
      items = trimmed.split('\n')
    }
  }
  return items.map((item) => String(item).trim()).filter(Boolean)
}

export const telegramSendPollTool: ToolConfig<TelegramSendPollParams, TelegramSendMessageResponse> =
  {
    id: 'telegram_send_poll',
    name: 'Telegram Send Poll',
    description: 'Send a native poll to a Telegram chat through the Telegram Bot API.',
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
      question: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Poll question (1-300 characters)',
      },
      options: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'List of 2-10 answer options as text strings',
      },
      isAnonymous: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the poll needs to be anonymous (defaults to true)',
      },
      allowsMultipleAnswers: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the poll allows multiple answers',
      },
    },

    request: {
      url: (params) => telegramApiUrl(params.botToken, 'sendPoll'),
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const optionList = normalizePollOptions(params.options)
        if (optionList.length < 2) {
          throw new Error('A poll requires at least 2 options')
        }
        const body: Record<string, unknown> = {
          chat_id: params.chatId,
          question: params.question,
          options: optionList.map((text) => ({ text })),
        }
        if (params.isAnonymous !== undefined) body.is_anonymous = params.isAnonymous
        if (params.allowsMultipleAnswers !== undefined) {
          body.allows_multiple_answers = params.allowsMultipleAnswers
        }
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.ok) {
        const errorMessage = data.description || data.error || 'Failed to send poll'
        throw new Error(errorMessage)
      }

      return {
        success: true,
        output: {
          message: 'Poll sent successfully',
          data: data.result as TelegramMessage,
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
      data: {
        type: 'object',
        description: 'Telegram message data for the sent poll',
        properties: {
          message_id: { type: 'number', description: 'Unique Telegram message identifier' },
          date: { type: 'number', description: 'Unix timestamp when message was sent' },
        },
      },
    },
  }
