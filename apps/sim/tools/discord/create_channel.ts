import type {
  DiscordCreateChannelParams,
  DiscordCreateChannelResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordCreateChannelTool: ToolConfig<
  DiscordCreateChannelParams,
  DiscordCreateChannelResponse
> = {
  id: 'discord_create_channel',
  name: 'Discord Create Channel',
  description: 'Create a new channel in a Discord server',
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
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the channel (1-100 characters)',
    },
    type: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Channel type (0=text, 2=voice, 4=category, 5=announcement, 13=stage)',
    },
    topic: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Channel topic (0-1024 characters)',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Parent category ID for the channel',
    },
  },

  request: {
    url: (params: DiscordCreateChannelParams) => {
      return `https://discord.com/api/v10/guilds/${params.serverId}/channels`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bot ${params.botToken}`,
    }),
    body: (params: DiscordCreateChannelParams) => {
      const body: any = {
        name: params.name,
      }
      if (params.type !== undefined) body.type = Number(params.type)
      if (params.topic) body.topic = params.topic
      if (params.parentId) body.parent_id = params.parentId
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Channel created successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Created channel data',
      properties: {
        id: { type: 'string', description: 'Channel ID' },
        name: { type: 'string', description: 'Channel name' },
        type: { type: 'number', description: 'Channel type' },
        guild_id: { type: 'string', description: 'Server ID' },
      },
    },
  },
}
