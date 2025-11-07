import type {
  DiscordArchiveThreadParams,
  DiscordArchiveThreadResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordArchiveThreadTool: ToolConfig<
  DiscordArchiveThreadParams,
  DiscordArchiveThreadResponse
> = {
  id: 'discord_archive_thread',
  name: 'Discord Archive Thread',
  description: 'Archive or unarchive a thread in Discord',
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
      description: 'The thread ID to archive/unarchive',
    },
    archived: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to archive (true) or unarchive (false) the thread',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordArchiveThreadParams) => {
      return `https://discord.com/api/v10/channels/${params.threadId}`
    },
    method: 'PATCH',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bot ${params.botToken}`,
    }),
    body: (params: DiscordArchiveThreadParams) => {
      return {
        archived: params.archived,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: data.archived ? 'Thread archived successfully' : 'Thread unarchived successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Updated thread data',
      properties: {
        id: { type: 'string', description: 'Thread ID' },
        archived: { type: 'boolean', description: 'Whether thread is archived' },
      },
    },
  },
}
