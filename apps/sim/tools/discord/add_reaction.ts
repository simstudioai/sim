import type { DiscordAddReactionParams, DiscordAddReactionResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
      visibility: 'user-or-llm',
      description: 'The Discord channel ID containing the message, e.g., 123456789012345678',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message to react to, e.g., 123456789012345678',
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
      visibility: 'user-or-llm',
      description: 'The Discord server ID (guild ID), e.g., 123456789012345678',
    },
  },

  request: {
    url: (params: DiscordAddReactionParams) => {
      const encodedEmoji = params.emoji
      return `https://discord.com/api/v10/channels/${safeUrlPathSegment(params.channelId, 'channelId')}/messages/${safeUrlPathSegment(params.messageId, 'messageId')}/reactions/${encodedEmoji}/@me`
    },
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bot ${params.botToken.trim()}`,
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
