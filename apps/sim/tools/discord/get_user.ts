import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type {
  DiscordAPIError,
  DiscordGetUserParams,
  DiscordGetUserResponse,
  DiscordUser,
} from './types'

const logger = createLogger('DiscordGetUser')

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
    if (!response.ok) {
      let errorMessage = `Failed to get Discord user: ${response.status} ${response.statusText}`

      try {
        const errorData = (await response.json()) as DiscordAPIError
        errorMessage = `Failed to get Discord user: ${errorData.message || response.statusText}`
        logger.error('Discord API error', { status: response.status, error: errorData })
      } catch (e) {
        logger.error('Error parsing Discord API response', { status: response.status, error: e })
      }

      return {
        success: false,
        output: {
          message: errorMessage,
        },
        error: errorMessage,
      }
    }

    let data: DiscordUser
    try {
      data = await response.clone().json()
    } catch (_e) {
      return {
        success: false,
        error: 'Failed to parse user data',
        output: { message: 'Failed to parse user data' },
      }
    }

    return {
      success: true,
      output: {
        message: `Retrieved information for Discord user: ${data.username}`,
        data,
      },
    }
  },

  transformError: (error) => {
    logger.error('Error retrieving Discord user information', { error })
    return `Error retrieving Discord user information: ${error.error}`
  },
}
