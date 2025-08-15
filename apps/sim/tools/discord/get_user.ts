import type {
  DiscordGetUserParams,
  DiscordGetUserResponse,
  DiscordUser,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordGetUserTool: ToolConfig<DiscordGetUserParams, DiscordGetUserResponse> = {
  id: 'discord_get_user',
  name: 'Discord Get User',
  description: 'Retrieve information about a Discord user',
  version: '1.0.0',

  params: {
    botToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Discord bot token for authentication',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord user ID',
    },
  },

  request: {
    url: (params: DiscordGetUserParams) => `https://discord.com/api/v10/users/${params.userId}`,
    method: 'GET',
    headers: (params: DiscordGetUserParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (params.botToken) {
        headers.Authorization = `Bot ${params.botToken}`
      }

      return headers
    },
  },

  transformResponse: async (response) => {
    const data: DiscordUser = await response.json()

    return {
      success: true,
      output: {
        message: `Retrieved information for Discord user: ${data.username}`,
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Discord user information',
      properties: {
        id: { type: 'string', description: 'User ID' },
        username: { type: 'string', description: 'Username' },
        discriminator: { type: 'string', description: 'User discriminator (4-digit number)' },
        avatar: { type: 'string', description: 'User avatar hash' },
        bot: { type: 'boolean', description: 'Whether user is a bot' },
        system: { type: 'boolean', description: 'Whether user is a system user' },
        email: { type: 'string', description: 'User email (if available)' },
        verified: { type: 'boolean', description: 'Whether user email is verified' },
      },
    },
  },
}
