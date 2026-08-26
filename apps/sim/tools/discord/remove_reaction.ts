import type {
  DiscordRemoveReactionParams,
  DiscordRemoveReactionResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Discord's own literal for "the current bot user" in a reaction path.
 *
 * Deleting a reaction is two distinct routes in Discord's OpenAPI spec:
 * `DELETE .../reactions/{emoji_name}/@me` (`delete_my_message_reaction`), where `@me` is a
 * literal segment, and `DELETE .../reactions/{emoji_name}/{user_id}`
 * (`delete_user_message_reaction`), where `{user_id}` is a snowflake.
 *
 * `safeUrlPathSegment` percent-encodes, so routing a typed-out `@me` through it yields `%40me` on
 * the *user_id* route — a user id that is not a snowflake and matches no member. Whether Discord's
 * router decodes before matching the literal segment is not documented, so nothing here relies on
 * it: a literal `@me` is recognized as the own-reaction case up front and takes the same
 * `/@me` route a blank `userId` already takes. Every other value stays guarded and encoded.
 */
const DISCORD_CURRENT_USER = '@me'

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
      visibility: 'user-or-llm',
      description: 'The Discord channel ID containing the message, e.g., 123456789012345678',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message with the reaction, e.g., 123456789012345678',
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
      description:
        "The user ID whose reaction to remove (omit, or pass \"@me\", to remove the bot's own reaction), e.g., 123456789012345678",
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Discord server ID (guild ID), e.g., 123456789012345678',
    },
  },

  request: {
    url: (params: DiscordRemoveReactionParams) => {
      const encodedEmoji = safeUrlPathSegment(params.emoji, 'emoji')
      const userId = params.userId?.trim()
      const userPart =
        userId && userId !== DISCORD_CURRENT_USER
          ? `/${safeUrlPathSegment(userId, 'userId')}`
          : `/${DISCORD_CURRENT_USER}`
      return `https://discord.com/api/v10/channels/${safeUrlPathSegment(params.channelId, 'channelId')}/messages/${safeUrlPathSegment(params.messageId, 'messageId')}/reactions/${encodedEmoji}${userPart}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bot ${params.botToken.trim()}`,
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
