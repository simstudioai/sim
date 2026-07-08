import type {
  DiscordGetServerParams,
  DiscordGetServerResponse,
  DiscordGuild,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordGetServerTool: ToolConfig<DiscordGetServerParams, DiscordGetServerResponse> = {
  id: 'discord_get_server',
  name: 'Discord Get Server',
  description: 'Retrieve information about a Discord server (guild)',
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
    url: (params: DiscordGetServerParams) =>
      `https://discord.com/api/v10/guilds/${params.serverId.trim()}?with_counts=true`,
    method: 'GET',
    headers: (params: DiscordGetServerParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (params.botToken) {
        headers.Authorization = `Bot ${params.botToken.trim()}`
      }

      return headers
    },
  },

  transformResponse: async (response: Response) => {
    const responseData = await response.json()

    return {
      success: true,
      output: {
        message: 'Successfully retrieved server information',
        data: responseData as DiscordGuild,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Discord server (guild) information',
      properties: {
        id: { type: 'string', description: 'Server ID' },
        name: { type: 'string', description: 'Server name' },
        icon: { type: 'string', description: 'Server icon hash' },
        description: { type: 'string', description: 'Server description' },
        owner_id: { type: 'string', description: 'Server owner user ID' },
        roles: { type: 'array', description: 'Server roles' },
        approximate_member_count: {
          type: 'number',
          description: 'Approximate total member count',
        },
        approximate_presence_count: {
          type: 'number',
          description: 'Approximate online member count',
        },
      },
    },
  },
}
