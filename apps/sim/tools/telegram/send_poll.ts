import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramMessage,
  TelegramSendMessageResponse,
  TelegramSendPollParams,
} from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

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
        const body: Record<string, unknown> = {
          chat_id: params.chatId,
          question: params.question,
          options: (params.options ?? []).map((option) => ({ text: option })),
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
