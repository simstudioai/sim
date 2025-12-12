import type { DiscordJoinThreadParams, DiscordJoinThreadResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordJoinThreadTool: ToolConfig<DiscordJoinThreadParams, DiscordJoinThreadResponse> =
  {
    id: 'discord_join_thread',
    name: 'Discord Join Thread',
    description: 'Join a thread in Discord',
    version: '1.0.0',

    params: {
      botToken: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'The bot token for authentication',
      },
      threadId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The thread ID to join',
      },
      serverId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'The Discord server ID (guild ID)',
      },
    },

    request: {
      url: (params: DiscordJoinThreadParams) => {
        return `https://discord.com/api/v10/channels/${params.threadId}/thread-members/@me`
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
          message: 'Joined thread successfully',
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
    },
  }
