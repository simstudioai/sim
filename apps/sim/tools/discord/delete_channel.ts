import type {
  DiscordDeleteChannelParams,
  DiscordDeleteChannelResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordDeleteChannelTool: ToolConfig<
  DiscordDeleteChannelParams,
  DiscordDeleteChannelResponse
> = {
  id: 'discord_delete_channel',
  name: 'Discord Delete Channel',
  description: 'Delete a Discord channel',
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
      description: 'The Discord channel ID to delete',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordDeleteChannelParams) => {
      return `https://discord.com/api/v10/channels/${params.channelId}`
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
        message: 'Channel deleted successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
