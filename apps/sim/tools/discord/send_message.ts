import type {
  DiscordMessage,
  DiscordSendMessageParams,
  DiscordSendMessageResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

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
    const data = (await response.json()) as DiscordMessage
    return {
      success: true,
      output: {
        message: 'Discord message sent successfully',
        data,
      },
    }
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
