import { createLogger } from '@/lib/logs/console/logger'
import type {
  DiscordAPIError,
  DiscordGetMessagesParams,
  DiscordGetMessagesResponse,
  DiscordMessage,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DiscordGetMessages')

export const discordGetMessagesTool: ToolConfig<
  DiscordGetMessagesParams,
  DiscordGetMessagesResponse
> = {
  id: 'discord_get_messages',
  name: 'Discord Get Messages',
  description: 'Retrieve messages from a Discord channel',
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
      description: 'The Discord channel ID to retrieve messages from',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of messages to retrieve (default: 10, max: 100)',
    },
  },

  request: {
    url: (params: DiscordGetMessagesParams) => {
      const limit = Math.min(params.limit || 10, 100)
      return `https://discord.com/api/v10/channels/${params.channelId}/messages?limit=${limit}`
    },
    method: 'GET',
    headers: (params) => {
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
      let errorMessage = `Failed to get Discord messages: ${response.status} ${response.statusText}`

      try {
        const errorData = (await response.json()) as DiscordAPIError
        errorMessage = `Failed to get Discord messages: ${errorData.message || response.statusText}`
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

    let messages: DiscordMessage[]
    try {
      messages = await response.json()
    } catch (_e) {
      return {
        success: false,
        error: 'Failed to parse messages',
        output: { message: 'Failed to parse messages' },
      }
    }
    return {
      success: true,
      output: {
        message: `Retrieved ${messages.length} messages from Discord channel`,
        data: {
          messages,
          channel_id: messages.length > 0 ? messages[0].channel_id : '',
        },
      },
    }
  },

  transformError: (error) => {
    logger.error('Error retrieving Discord messages', { error })
    return `Error retrieving Discord messages: ${error instanceof Error ? error.message : String(error)}`
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    messages: {
      type: 'array',
      description: 'Array of Discord messages with full metadata',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Message ID' },
          content: { type: 'string', description: 'Message content' },
          channel_id: { type: 'string', description: 'Channel ID' },
          author: {
            type: 'object',
            description: 'Message author information',
            properties: {
              id: { type: 'string', description: 'Author user ID' },
              username: { type: 'string', description: 'Author username' },
              avatar: { type: 'string', description: 'Author avatar hash' },
              bot: { type: 'boolean', description: 'Whether author is a bot' },
            },
          },
          timestamp: { type: 'string', description: 'Message timestamp' },
          edited_timestamp: { type: 'string', description: 'Message edited timestamp' },
          embeds: { type: 'array', description: 'Message embeds' },
          attachments: { type: 'array', description: 'Message attachments' },
          mentions: { type: 'array', description: 'User mentions in message' },
          mention_roles: { type: 'array', description: 'Role mentions in message' },
          mention_everyone: { type: 'boolean', description: 'Whether message mentions everyone' },
        },
      },
    },
  },
}
