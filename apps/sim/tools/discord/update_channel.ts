import type {
  DiscordUpdateChannelParams,
  DiscordUpdateChannelResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordUpdateChannelTool: ToolConfig<
  DiscordUpdateChannelParams,
  DiscordUpdateChannelResponse
> = {
  id: 'discord_update_channel',
  name: 'Discord Update Channel',
  description: 'Update a Discord channel',
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
      description: 'The Discord channel ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The new name for the channel',
    },
    topic: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The new topic for the channel',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordUpdateChannelParams) => {
      return `https://discord.com/api/v10/channels/${params.channelId}`
    },
    method: 'PATCH',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bot ${params.botToken}`,
    }),
    body: (params: DiscordUpdateChannelParams) => {
      const body: any = {}
      if (params.name !== undefined && params.name !== null && params.name !== '')
        body.name = params.name
      if (params.topic !== undefined && params.topic !== null && params.topic !== '')
        body.topic = params.topic
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Channel updated successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Updated channel data',
      properties: {
        id: { type: 'string', description: 'Channel ID' },
        name: { type: 'string', description: 'Channel name' },
        type: { type: 'number', description: 'Channel type' },
        topic: { type: 'string', description: 'Channel topic' },
      },
    },
  },
}
