import { createLogger } from '@/lib/logs/console-logger'
import { ToolConfig } from '../types'
import { DiscordGetUserParams, DiscordGetUserResponse } from './types'

const logger = createLogger('DiscordGetUser')

export const discordGetUserTool: ToolConfig<DiscordGetUserParams, DiscordGetUserResponse> = {
  id: 'discord_get_user',
  name: 'Discord Get User',
  description: 'Retrieve information about a Discord user',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'discord',
  },

  params: {
    userId: {
      type: 'string',
      required: true,
      description: 'The Discord user ID',
    },
    botToken: {
      type: 'string',
      required: false,
      description: 'The bot token for authentication (required if credential not provided)',
    },
    credential: {
      type: 'string',
      required: false,
      description: 'Discord OAuth credential ID (required if botToken not provided)',
    },
  },

  request: {
    url: (params: DiscordGetUserParams) => `https://discord.com/api/v10/users/${params.userId}`,
    method: 'GET',
    headers: (params: DiscordGetUserParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // If botToken is provided, use it for authorization
      if (params.botToken) {
        headers['Authorization'] = `Bot ${params.botToken}`
      }

      return headers
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      let errorMessage = `Failed to get Discord user: ${response.status} ${response.statusText}`

      try {
        const errorData = await response.json()
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

    let data
    try {
      data = await response.json()
    } catch (e) {
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
    return `Error retrieving Discord user information: ${error.error || String(error.error)}`
  },
}
