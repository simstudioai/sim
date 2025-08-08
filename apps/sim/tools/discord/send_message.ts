import { createLogger } from '@/lib/logs/console/logger'
import type {
  DiscordAPIError,
  DiscordMessage,
  DiscordSendMessageParams,
  DiscordSendMessageResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DiscordSendMessage')

export const discordSendMessageTool: ToolConfig<
  DiscordSendMessageParams,
  DiscordSendMessageResponse
> = {
  id: 'discord_send_message',
  name: 'Discord Send Message',
  description: 'Send a message to a Discord channel',
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
      description: 'The Discord channel ID to send the message to',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The text content of the message',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordSendMessageParams) =>
      `https://discord.com/api/v10/channels/${params.channelId}/messages`,
    method: 'POST',
    headers: (params: DiscordSendMessageParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (params.botToken) {
        headers.Authorization = `Bot ${params.botToken}`
      }

      return headers
    },
    body: (params: DiscordSendMessageParams) => {
      const body: Record<string, any> = {}

      if (params.content) {
        body.content = params.content
      }

      if (!body.content) {
        body.content = 'Message sent from Sim'
      }

      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      let errorMessage = `Failed to send Discord message: ${response.status} ${response.statusText}`

      try {
        const errorData = (await response.json()) as DiscordAPIError
        errorMessage = `Failed to send Discord message: ${errorData.message || response.statusText}`
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

    try {
      const data = (await response.json()) as DiscordMessage
      return {
        success: true,
        output: {
          message: 'Discord message sent successfully',
          data,
        },
      }
    } catch (e) {
      logger.error('Error parsing successful Discord response', { error: e })
      return {
        success: false,
        error: 'Failed to parse Discord response',
        output: {
          message: 'Failed to parse Discord response',
        },
      }
    }
  },

  transformError: (error: Error | unknown): string => {
    logger.error('Error sending Discord message', { error })
    return `Error sending Discord message: ${error instanceof Error ? error.message : String(error)}`
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Discord message data',
      properties: {
        id: { type: 'string', description: 'Message ID' },
        content: { type: 'string', description: 'Message content' },
        channel_id: { type: 'string', description: 'Channel ID where message was sent' },
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
}
