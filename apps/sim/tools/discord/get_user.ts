import type {
  DiscordGetUserParams,
  DiscordGetUserResponse,
  DiscordUser,
} from '@/tools/discord/types'
import { DISCORD_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const discordGetUserTool: ToolConfig<DiscordGetUserParams, DiscordGetUserResponse> = {
  id: 'discord_get_user',
  name: 'Discord Get User',
  description: 'Retrieve information about a Discord user',
  version: '1.0.0',
  oauth: DISCORD_CREDENTIAL_OAUTH,

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
      visibility: 'user-or-llm',
      description: 'The Discord user ID, e.g., 123456789012345678',
    },
  },

  request: {
    url: (params: DiscordGetUserParams) =>
      `https://discord.com/api/v10/users/${safeUrlPathSegment(params.userId, 'userId')}`,
    method: 'GET',
    headers: (params: DiscordGetUserParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (params.botToken) {
        headers.Authorization = `Bot ${params.botToken.trim()}`
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
        global_name: {
          type: 'string',
          description: 'User display name, if set',
          nullable: true,
        },
        avatar: { type: 'string', description: 'User avatar hash', nullable: true },
        bot: { type: 'boolean', description: 'Whether user is a bot' },
        system: { type: 'boolean', description: 'Whether user is a system user' },
        email: {
          type: 'string',
          description: 'User email. Not returned for a user looked up by ID',
          optional: true,
          nullable: true,
        },
        verified: {
          type: 'boolean',
          description:
            'Whether the user email is verified. Not returned for a user looked up by ID',
          optional: true,
        },
      },
    },
  },
}
