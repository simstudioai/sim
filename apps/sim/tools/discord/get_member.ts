import type { DiscordGetMemberParams, DiscordGetMemberResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordGetMemberTool: ToolConfig<DiscordGetMemberParams, DiscordGetMemberResponse> = {
  id: 'discord_get_member',
  name: 'Discord Get Member',
  description: 'Get information about a member in a Discord server',
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ID to retrieve',
    },
  },

  request: {
    url: (params: DiscordGetMemberParams) => {
      return `https://discord.com/api/v10/guilds/${params.serverId}/members/${params.userId}`
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
        message: 'Member information retrieved successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Member data',
      properties: {
        user: {
          type: 'object',
          description: 'User information',
          properties: {
            id: { type: 'string', description: 'User ID' },
            username: { type: 'string', description: 'Username' },
            avatar: { type: 'string', description: 'Avatar hash' },
          },
        },
        nick: { type: 'string', description: 'Server nickname' },
        roles: { type: 'array', description: 'Array of role IDs' },
        joined_at: { type: 'string', description: 'When the member joined' },
      },
    },
  },
}
