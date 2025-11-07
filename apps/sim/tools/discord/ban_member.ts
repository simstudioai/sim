import type { DiscordBanMemberParams, DiscordBanMemberResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordBanMemberTool: ToolConfig<DiscordBanMemberParams, DiscordBanMemberResponse> = {
  id: 'discord_ban_member',
  name: 'Discord Ban Member',
  description: 'Ban a member from a Discord server',
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
      description: 'The user ID to ban',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for banning the member',
    },
    deleteMessageDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of days to delete messages for (0-7)',
    },
  },

  request: {
    url: (params: DiscordBanMemberParams) => {
      return `https://discord.com/api/v10/guilds/${params.serverId}/bans/${params.userId}`
    },
    method: 'PUT',
    headers: (params) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bot ${params.botToken}`,
      }
      if (params.reason) {
        headers['X-Audit-Log-Reason'] = encodeURIComponent(params.reason)
      }
      return headers
    },
    body: (params: DiscordBanMemberParams) => {
      const body: any = {}
      if (params.deleteMessageDays !== undefined) {
        body.delete_message_days = Number(params.deleteMessageDays)
      }
      return body
    },
  },

  transformResponse: async (response) => {
    return {
      success: true,
      output: {
        message: 'Member banned successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
