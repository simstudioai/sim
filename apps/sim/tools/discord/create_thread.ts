import type { DiscordCreateThreadParams, DiscordCreateThreadResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordCreateThreadTool: ToolConfig<
  DiscordCreateThreadParams,
  DiscordCreateThreadResponse
> = {
  id: 'discord_create_thread',
  name: 'Discord Create Thread',
  description: 'Create a thread in a Discord channel',
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
      description: 'The Discord channel ID to create the thread in, e.g., 123456789012345678',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the thread (1-100 characters)',
    },
    messageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The message ID to create a thread from (if creating from existing message), e.g., 123456789012345678',
    },
    autoArchiveDuration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration in minutes to auto-archive the thread (60, 1440, 4320, 10080)',
    },
    isPublic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the standalone thread is public (visible to everyone in the channel) or private. Ignored when creating a thread from an existing message, which always inherits the parent channel visibility. Defaults to public if omitted.',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Discord server ID (guild ID), e.g., 123456789012345678',
    },
  },

  request: {
    url: (params: DiscordCreateThreadParams) => {
      const messageId = params.messageId?.trim()
      if (messageId) {
        return `https://discord.com/api/v10/channels/${params.channelId.trim()}/messages/${messageId}/threads`
      }
      return `https://discord.com/api/v10/channels/${params.channelId.trim()}/threads`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bot ${params.botToken.trim()}`,
    }),
    body: (params: DiscordCreateThreadParams) => {
      const body: any = {
        name: params.name,
      }
      if (params.autoArchiveDuration) {
        body.auto_archive_duration = Number(params.autoArchiveDuration)
      }
      // Standalone threads (no source message) default to PRIVATE_THREAD per the Discord API
      // unless `type` is explicitly set, so pin it to PUBLIC_THREAD (11) unless the caller opts out.
      if (!params.messageId?.trim()) {
        body.type = params.isPublic === false ? 12 : 11
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Thread created successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Created thread data',
      properties: {
        id: { type: 'string', description: 'Thread ID' },
        name: { type: 'string', description: 'Thread name' },
        type: { type: 'number', description: 'Thread channel type' },
        guild_id: { type: 'string', description: 'Server ID' },
        parent_id: { type: 'string', description: 'Parent channel ID' },
      },
    },
  },
}
