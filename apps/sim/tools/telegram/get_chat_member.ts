import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramChatMember,
  TelegramGetChatMemberParams,
  TelegramGetChatMemberResponse,
} from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramGetChatMemberTool: ToolConfig<
  TelegramGetChatMemberParams,
  TelegramGetChatMemberResponse
> = {
  id: 'telegram_get_chat_member',
  name: 'Telegram Get Chat Member',
  description: 'Get information about a member of a Telegram chat through the Telegram Bot API.',
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
      description: 'Telegram chat ID or @username (numeric, can be negative for groups)',
    },
    userId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the target user',
    },
  },

  request: {
    url: (params) => telegramApiUrl(params.botToken, 'getChatMember'),
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      chat_id: params.chatId,
      user_id: params.userId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to get chat member'
      throw new Error(errorMessage)
    }

    const result = data.result

    return {
      success: true,
      output: {
        message: 'Chat member retrieved successfully',
        data: {
          status: result.status,
          user: result.user,
        } as TelegramChatMember,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Telegram chat member information',
      properties: {
        status: {
          type: 'string',
          description: "Member's status (creator, administrator, member, restricted, left, kicked)",
        },
        user: {
          type: 'object',
          description: 'Information about the user',
          properties: {
            id: { type: 'number', description: 'Unique user identifier' },
            is_bot: { type: 'boolean', description: 'Whether the user is a bot' },
            first_name: { type: 'string', description: "User's first name" },
            last_name: { type: 'string', description: "User's last name" },
            username: { type: 'string', description: "User's username" },
          },
        },
      },
    },
  },
}
