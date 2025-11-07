import type { DiscordLeaveThreadParams, DiscordLeaveThreadResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordLeaveThreadTool: ToolConfig<
  DiscordLeaveThreadParams,
  DiscordLeaveThreadResponse
> = {
  id: 'discord_leave_thread',
  name: 'Discord Leave Thread',
  description: 'Leave a thread in Discord',
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
      description: 'The thread ID to leave',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordLeaveThreadParams) => {
      return `https://discord.com/api/v10/channels/${params.threadId}/thread-members/@me`
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
        message: 'Left thread successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
