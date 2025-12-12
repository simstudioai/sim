import type { DiscordGetChannelParams, DiscordGetChannelResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordGetChannelTool: ToolConfig<DiscordGetChannelParams, DiscordGetChannelResponse> =
  {
    id: 'discord_get_channel',
    name: 'Discord Get Channel',
    description: 'Get information about a Discord channel',
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
        description: 'The Discord channel ID to retrieve',
      },
      serverId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'The Discord server ID (guild ID)',
      },
    },

    request: {
      url: (params: DiscordGetChannelParams) => {
        return `https://discord.com/api/v10/channels/${params.channelId}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bot ${params.botToken}`,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      return {
        success: true,
        output: {
          message: 'Channel information retrieved successfully',
          data,
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
      data: {
        type: 'object',
        description: 'Channel data',
        properties: {
          id: { type: 'string', description: 'Channel ID' },
          name: { type: 'string', description: 'Channel name' },
          type: { type: 'number', description: 'Channel type' },
          topic: { type: 'string', description: 'Channel topic' },
          guild_id: { type: 'string', description: 'Server ID' },
        },
      },
    },
  }
