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
      visibility: 'user-only',
      description: 'The Discord channel ID containing the message',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message to delete',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
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
