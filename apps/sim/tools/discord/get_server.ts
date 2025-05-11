import { createLogger } from '@/lib/logs/console-logger'
import { ToolConfig } from '../types'
import { DiscordGetServerParams, DiscordGetServerResponse } from './types'

const logger = createLogger('DiscordGetServer')

export const discordGetServerTool: ToolConfig<DiscordGetServerParams, DiscordGetServerResponse> = {
  id: 'discord_get_server',
  name: 'Discord Get Server',
  description: 'Retrieve information about a Discord server (guild)',
  version: '1.0.0',

  params: {
    serverId: {
      type: 'string',
      required: true,
      description: 'The Discord server ID (guild ID)',
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
    url: (params: DiscordGetServerParams) =>
      `https://discord.com/api/v10/guilds/${params.serverId}`,
    method: 'GET',
    headers: (params: DiscordGetServerParams) => {
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

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      let errorMessage = `Discord API error: ${response.status} ${response.statusText}`

      try {
        const errorData = await response.json()
        logger.error('Discord API error', {
          status: response.status,
          error: errorData,
        })
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

    let serverData
    try {
      serverData = await response.json()
    } catch (e) {
      logger.error('Error parsing Discord API response', { error: e })
      return {
        success: false,
        error: 'Failed to parse server data',
        output: { message: 'Failed to parse server data' },
      }
    }

    return {
      success: true,
      output: {
        message: 'Successfully retrieved server information',
        data: serverData,
      },
    }
  },

  transformError: (error: any): string => {
    logger.error('Error fetching Discord server', { error })
    return `Error fetching Discord server: ${error.error || String(error.error)}`
  },
}
