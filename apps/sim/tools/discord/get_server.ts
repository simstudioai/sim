import { createLogger } from '@/lib/logs/console/logger'
import type {
  DiscordAPIError,
  DiscordGetServerParams,
  DiscordGetServerResponse,
  DiscordGuild,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DiscordGetServer')

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
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
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

      if (params.botToken) {
        headers.Authorization = `Bot ${params.botToken}`
      }

      return headers
    },
  },

  transformResponse: async (response: Response) => {
    let responseData: any

    try {
      responseData = await response.json()
    } catch (e) {
      logger.error('Error parsing Discord API response', { status: response.status, error: e })
      return {
        success: false,
        error: 'Failed to parse server data',
        output: { message: 'Failed to parse server data' },
      }
    }

    if (!response.ok) {
      const errorData = responseData as DiscordAPIError
      const errorMessage = `Discord API error: ${errorData.message || response.statusText}`

      logger.error('Discord API error', {
        status: response.status,
        error: errorData,
      })

      return {
        success: false,
        output: {
          message: errorMessage,
        },
        error: errorMessage,
      }
    }

    return {
      success: true,
      output: {
        message: 'Successfully retrieved server information',
        data: responseData as DiscordGuild,
      },
    }
  },

  transformError: (error: Error | unknown): string => {
    logger.error('Error fetching Discord server', { error })
    return `Error fetching Discord server: ${error instanceof Error ? error.message : String(error)}`
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
        channels: { type: 'array', description: 'Server channels' },
        member_count: { type: 'number', description: 'Number of members in server' },
      },
    },
  },
}
