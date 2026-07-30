import type {
  DiscordBulkDeleteMessagesParams,
  DiscordBulkDeleteMessagesResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordBulkDeleteMessagesTool: ToolConfig<
  DiscordBulkDeleteMessagesParams,
  DiscordBulkDeleteMessagesResponse
> = {
  id: 'discord_bulk_delete_messages',
  name: 'Discord Bulk Delete Messages',
  description: 'Delete 2-100 messages from a Discord channel in a single request',
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
      description: 'The Discord channel ID to delete messages from, e.g., 123456789012345678',
    },
    messageIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of 2-100 message IDs to delete. Messages older than 2 weeks cannot be bulk deleted.',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Discord server ID (guild ID), e.g., 123456789012345678',
    },
  },

  request: {
    url: (params: DiscordBulkDeleteMessagesParams) => {
      return `https://discord.com/api/v10/channels/${params.channelId.trim()}/messages/bulk-delete`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bot ${params.botToken.trim()}`,
    }),
    body: (params: DiscordBulkDeleteMessagesParams) => {
      const messages = (Array.isArray(params.messageIds) ? params.messageIds : [params.messageIds])
        .map((id) => String(id).trim())
        .filter(Boolean)
      if (messages.length < 2 || messages.length > 100) {
        throw new Error(
          `Discord requires 2-100 message IDs for bulk delete, got ${messages.length}`
        )
      }
      return { messages }
    },
  },

  transformResponse: async () => {
    return {
      success: true,
      output: {
        message: 'Messages deleted successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
