import type { DiscordAddReactionParams, DiscordAddReactionResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordAddReactionTool: ToolConfig<
  DiscordAddReactionParams,
  DiscordAddReactionResponse
> = {
  id: 'discord_add_reaction',
  name: 'Discord Add Reaction',
  description: 'Add a reaction emoji to a Discord message',
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
      description: 'The ID of the message to react to',
    },
    emoji: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The emoji to react with (unicode emoji or custom emoji in name:id format)',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordAddReactionParams) => {
      const encodedEmoji = encodeURIComponent(params.emoji)
      return `https://discord.com/api/v10/channels/${params.channelId}/messages/${params.messageId}/reactions/${encodedEmoji}/@me`
    },
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bot ${params.botToken}`,
    }),
  },

  transformResponse: async (response) => {
    return {
      success: true,
      output: {
        message: 'Reaction added successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
