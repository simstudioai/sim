import type {
  DiscordRemoveReactionParams,
  DiscordRemoveReactionResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordRemoveReactionTool: ToolConfig<
  DiscordRemoveReactionParams,
  DiscordRemoveReactionResponse
> = {
  id: 'discord_remove_reaction',
  name: 'Discord Remove Reaction',
  description: 'Remove a reaction from a Discord message',
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
      description: 'The ID of the message with the reaction',
    },
    emoji: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The emoji to remove (unicode emoji or custom emoji in name:id format)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The user ID whose reaction to remove (omit to remove bot's own reaction)",
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordRemoveReactionParams) => {
      const encodedEmoji = encodeURIComponent(params.emoji)
      const userPart = params.userId ? `/${params.userId}` : '/@me'
      return `https://discord.com/api/v10/channels/${params.channelId}/messages/${params.messageId}/reactions/${encodedEmoji}${userPart}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bot ${params.botToken}`,
    }),
  },

  transformResponse: async (response) => {
    return {
      success: true,
      output: {
        message: 'Reaction removed successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
