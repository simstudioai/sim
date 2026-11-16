import type { DiscordGetMessagesParams, DiscordGetMessagesResponse } from '@/tools/discord/types'
import { DISCORD_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const discordGetMessagesTool: ToolConfig<
  DiscordGetMessagesParams,
  DiscordGetMessagesResponse
> = {
  id: 'discord_get_messages',
  name: 'Discord Get Messages',
  description: 'Retrieve messages from a Discord channel',
  version: '1.0.0',
  oauth: DISCORD_CREDENTIAL_OAUTH,

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
      description: 'The Discord channel ID to retrieve messages from, e.g., 123456789012345678',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of messages to retrieve (default: 10, max: 100)',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return messages before this message ID, to page back through history. Use only one of before, after, or around.',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return messages after this message ID, e.g. to read only messages newer than the last one seen',
    },
    around: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return messages around this message ID',
    },
  },

  request: {
    url: (params: DiscordGetMessagesParams) => {
      const requested = Math.trunc(Number(params.limit))
      const limit = requested && Number.isFinite(requested) ? requested : 10
      const query = new URLSearchParams({ limit: String(Math.min(Math.max(1, limit), 100)) })
      const cursors = (['before', 'after', 'around'] as const).flatMap((cursor) => {
        const value = String(params[cursor] ?? '').trim()
        return value ? [[cursor, value] as const] : []
      })
      if (cursors.length > 1) {
        throw new Error('Use only one of before, after, or around')
      }
      for (const [cursor, value] of cursors) query.set(cursor, value)
      return `https://discord.com/api/v10/channels/${safeUrlPathSegment(params.channelId, 'channelId')}/messages?${query.toString()}`
    },
    method: 'GET',
    headers: (params) => {
      const headers: Record<string, string> = {}

      if (params.botToken) {
        headers.Authorization = `Bot ${params.botToken.trim()}`
      }

      return headers
    },
  },

  transformResponse: async (response) => {
    const messages = await response.json()
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

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Container for messages data',
      properties: {
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
              edited_timestamp: {
                type: 'string',
                description: 'Message edited timestamp',
                optional: true,
                nullable: true,
              },
              embeds: { type: 'array', description: 'Message embeds' },
              attachments: { type: 'array', description: 'Message attachments' },
              mentions: { type: 'array', description: 'User mentions in message' },
              mention_roles: { type: 'array', description: 'Role mentions in message' },
              mention_everyone: {
                type: 'boolean',
                description: 'Whether message mentions everyone',
              },
            },
          },
        },
        channel_id: { type: 'string', description: 'Channel ID' },
      },
    },
  },
}
