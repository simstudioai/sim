import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramBooleanResponse,
  TelegramSetMessageReactionParams,
} from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramSetMessageReactionTool: ToolConfig<
  TelegramSetMessageReactionParams,
  TelegramBooleanResponse
> = {
  id: 'telegram_set_message_reaction',
  name: 'Telegram Set Message Reaction',
  description:
    'Set or remove an emoji reaction on a message in a Telegram chat through the Telegram Bot API.',
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
      description: 'Identifier of the target message',
    },
    reaction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Emoji to react with (leave empty to remove the reaction)',
    },
    isBig: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pass true to show the reaction with a big animation',
    },
  },

  request: {
    url: (params) => telegramApiUrl(params.botToken, 'setMessageReaction'),
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        chat_id: params.chatId,
        message_id: params.messageId,
        reaction: params.reaction ? [{ type: 'emoji', emoji: params.reaction }] : [],
      }
      if (params.isBig !== undefined) body.is_big = params.isBig
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to set message reaction'
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        message: 'Message reaction set successfully',
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
      description: 'Reaction operation result',
      properties: {
        ok: { type: 'boolean', description: 'API response success status' },
        result: { type: 'boolean', description: 'Whether the reaction was set' },
      },
    },
  },
}
