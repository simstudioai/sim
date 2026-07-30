import type { DiscordListChannelsParams, DiscordListChannelsResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordListChannelsTool: ToolConfig<
  DiscordListChannelsParams,
  DiscordListChannelsResponse
> = {
  id: 'discord_list_channels',
  name: 'Discord List Channels',
  description: 'List all channels in a Discord server',
  version: '1.0.0',

  params: {
    botToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The bot token for authentication',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Discord server ID (guild ID), e.g., 123456789012345678',
    },
  },

  request: {
    url: (params: DiscordListChannelsParams) => {
      return `https://discord.com/api/v10/guilds/${params.serverId.trim()}/channels`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bot ${params.botToken.trim()}`,
    }),
  },

  transformResponse: async (response) => {
    const channels = await response.json()
    return {
      success: true,
      output: {
        message: `Retrieved ${channels.length} channels from Discord server`,
        data: channels,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'array',
      description: 'Array of Discord channels in the server',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Channel ID' },
          name: { type: 'string', description: 'Channel name' },
          type: { type: 'number', description: 'Channel type' },
          topic: { type: 'string', description: 'Channel topic' },
          parent_id: { type: 'string', description: 'Parent category ID' },
          position: { type: 'number', description: 'Sort position within the channel list' },
        },
      },
    },
  },
}
