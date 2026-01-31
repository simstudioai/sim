import type {
  DiscordDeleteMessageParams,
  DiscordDeleteMessageResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordDeleteMessageTool: ToolConfig<
  DiscordDeleteMessageParams,
  DiscordDeleteMessageResponse
> = {
  id: 'discord_delete_message',
  name: 'Discord Delete Message',
  description: 'Delete a message from a Discord channel',
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
      description: 'The Discord channel ID containing the message, e.g., 123456789012345678',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message to delete, e.g., 123456789012345678',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Discord server ID (guild ID), e.g., 123456789012345678',
    },
  },

  request: {
    url: (params: DiscordDeleteMessageParams) => {
      return `https://discord.com/api/v10/channels/${params.channelId}/messages/${params.messageId}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bot ${params.botToken}`,
    }),
  },

  transformResponse: async (response) => {
    return {
      success: true,
      output: {
        message: 'Message deleted successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
