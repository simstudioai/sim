import type {
  DiscordGetPinnedMessagesParams,
  DiscordGetPinnedMessagesResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordGetPinnedMessagesTool: ToolConfig<
  DiscordGetPinnedMessagesParams,
  DiscordGetPinnedMessagesResponse
> = {
  id: 'discord_get_pinned_messages',
  name: 'Discord Get Pinned Messages',
  description: 'Retrieve all pinned messages in a Discord channel',
  version: '1.0.0',

  params: {
    botToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The bot token for authentication',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The Discord channel ID to retrieve pinned messages from, e.g., 123456789012345678',
    },
  },

  request: {
    url: (params: DiscordGetPinnedMessagesParams) => {
      return `https://discord.com/api/v10/channels/${params.channelId.trim()}/messages/pins`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bot ${params.botToken.trim()}`,
    }),
  },

  transformResponse: async (response) => {
    const result = await response.json()
    const items: Array<{ message: Record<string, unknown>; pinned_at: string }> = result.items ?? []
    return {
      success: true,
      output: {
        message: `Retrieved ${items.length} pinned messages from Discord channel`,
        data: items.map((item) => ({ ...item.message, pinned_at: item.pinned_at })),
        hasMore: result.has_more ?? false,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'array',
      description: 'Array of pinned Discord messages',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Message ID' },
          content: { type: 'string', description: 'Message content' },
          channel_id: { type: 'string', description: 'Channel ID' },
          timestamp: { type: 'string', description: 'Message timestamp' },
          pinned_at: { type: 'string', description: 'When the message was pinned' },
          author: {
            type: 'object',
            description: 'Message author information',
            properties: {
              id: { type: 'string', description: 'Author user ID' },
              username: { type: 'string', description: 'Author username' },
            },
          },
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more pinned messages exist beyond this page',
    },
  },
}
