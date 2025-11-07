import type { DiscordEditMessageParams, DiscordEditMessageResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordEditMessageTool: ToolConfig<
  DiscordEditMessageParams,
  DiscordEditMessageResponse
> = {
  id: 'discord_edit_message',
  name: 'Discord Edit Message',
  description: 'Edit an existing message in a Discord channel',
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
      description: 'The Discord channel ID containing the message',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message to edit',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The new text content for the message',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordEditMessageParams) => {
      return `https://discord.com/api/v10/channels/${params.channelId}/messages/${params.messageId}`
    },
    method: 'PATCH',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bot ${params.botToken}`,
    }),
    body: (params: DiscordEditMessageParams) => {
      const body: any = {}
      if (params.content !== undefined && params.content !== null && params.content !== '') {
        body.content = params.content
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Message edited successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Updated Discord message data',
      properties: {
        id: { type: 'string', description: 'Message ID' },
        content: { type: 'string', description: 'Updated message content' },
        channel_id: { type: 'string', description: 'Channel ID' },
        edited_timestamp: { type: 'string', description: 'Message edited timestamp' },
      },
    },
  },
}
