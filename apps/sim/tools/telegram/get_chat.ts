import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  TelegramChatFullInfo,
  TelegramGetChatParams,
  TelegramGetChatResponse,
} from '@/tools/telegram/types'
import { telegramApiUrl } from '@/tools/telegram/utils'
import type { ToolConfig } from '@/tools/types'

export const telegramGetChatTool: ToolConfig<TelegramGetChatParams, TelegramGetChatResponse> = {
  id: 'telegram_get_chat',
  name: 'Telegram Get Chat',
  description: 'Get up-to-date information about a Telegram chat through the Telegram Bot API.',
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
  },

  request: {
    url: (params) => telegramApiUrl(params.botToken, 'getChat'),
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      chat_id: params.chatId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      const errorMessage = data.description || data.error || 'Failed to get chat'
      throw new Error(errorMessage)
    }

    const result = data.result

    return {
      success: true,
      output: {
        message: 'Chat info retrieved successfully',
        data: {
          id: result.id,
          type: result.type,
          title: result.title ?? null,
          username: result.username ?? null,
          first_name: result.first_name ?? null,
          last_name: result.last_name ?? null,
          description: result.description ?? null,
          bio: result.bio ?? null,
          invite_link: result.invite_link ?? null,
          linked_chat_id: result.linked_chat_id ?? null,
        } as TelegramChatFullInfo,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Telegram chat information',
      properties: {
        id: { type: 'number', description: 'Unique chat identifier' },
        type: { type: 'string', description: 'Chat type (private, group, supergroup, channel)' },
        title: { type: 'string', description: 'Chat title for groups and channels' },
        username: { type: 'string', description: 'Chat username, if available' },
        first_name: { type: 'string', description: 'First name for private chats' },
        last_name: { type: 'string', description: 'Last name for private chats' },
        description: { type: 'string', description: 'Chat description' },
        bio: { type: 'string', description: 'Bio of the other party in a private chat' },
        invite_link: { type: 'string', description: 'Primary invite link for the chat' },
        linked_chat_id: { type: 'number', description: 'Linked discussion or channel chat ID' },
      },
    },
  },
}
