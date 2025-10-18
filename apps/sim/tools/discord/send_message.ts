import type { DiscordSendMessageParams, DiscordSendMessageResponse } from '@/tools/discord/types'
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
    files: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the message',
    },
  },

  request: {
    url: '/api/tools/discord/send-message',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: DiscordSendMessageParams) => {
      return {
        botToken: params.botToken,
        channelId: params.channelId,
        content: params.content || 'Message sent from Sim',
        files: params.files || null,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to send Discord message')
    }
    return {
      success: true,
      output: data.output,
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
