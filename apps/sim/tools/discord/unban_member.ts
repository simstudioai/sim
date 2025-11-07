import type { DiscordUnbanMemberParams, DiscordUnbanMemberResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordUnbanMemberTool: ToolConfig<
  DiscordUnbanMemberParams,
  DiscordUnbanMemberResponse
> = {
  id: 'discord_unban_member',
  name: 'Discord Unban Member',
  description: 'Unban a member from a Discord server',
  version: '1.0.0',

  params: {
    botToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The bot token for authentication',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ID to unban',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for unbanning the member',
    },
  },

  request: {
    url: (params: DiscordUnbanMemberParams) => {
      return `https://discord.com/api/v10/guilds/${params.serverId}/bans/${params.userId}`
    },
    method: 'DELETE',
    headers: (params) => {
      const headers: Record<string, string> = {
        Authorization: `Bot ${params.botToken}`,
      }
      if (params.reason) {
        headers['X-Audit-Log-Reason'] = encodeURIComponent(params.reason)
      }
      return headers
    },
  },

  transformResponse: async (response) => {
    return {
      success: true,
      output: {
        message: 'Member unbanned successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
