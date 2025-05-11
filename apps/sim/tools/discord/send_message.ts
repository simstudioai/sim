import { createLogger } from '@/lib/logs/console-logger'
import { ToolConfig } from '../types'
import { DiscordSendMessageParams, DiscordSendMessageResponse } from './types'

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
    channelId: {
      type: 'string',
      required: true,
      description: 'The Discord channel ID to send the message to',
    },
    content: {
      type: 'string',
      required: false,
      description: 'The text content of the message',
    },
    embed: {
      type: 'object',
      required: false,
      description: 'Optional rich embed for the message',
    },
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
    url: (params: DiscordSendMessageParams) =>
      `https://discord.com/api/v10/channels/${params.channelId}/messages`,
    method: 'POST',
    headers: (params: DiscordSendMessageParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // If botToken is provided, use it for authorization
      if (params.botToken) {
        headers['Authorization'] = `Bot ${params.botToken}`
      }

      return headers
    },
    body: (params) => {
      const body: any = {}

      // Add content if provided
      if (params.content) {
        body.content = params.content
      }

      // Add embed if provided
      if (params.embed) {
        body.embeds = [
          {
            title: params.embed.title,
            description: params.embed.description,
            color: params.embed.color
              ? parseInt(params.embed.color.replace('#', ''), 16)
              : undefined,
          },
        ]
      }

      // Ensure at least content or embeds is provided
      if (!body.content && (!body.embeds || body.embeds.length === 0)) {
        body.content = 'Message sent from Sim Studio'
      }

      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      let errorMessage = `Failed to send Discord message: ${response.status} ${response.statusText}`

      try {
        const errorData = await response.json()
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

    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Discord message sent successfully',
        data,
      },
    }
  },

  transformError: (error) => {
    logger.error('Error sending Discord message', { error })
    return `Error sending Discord message: ${error.error || String(error.error)}`
  },
}
