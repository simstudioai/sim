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
      visibility: 'user-or-llm',
      description: 'The Discord server ID (guild ID), e.g., 123456789012345678',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ID to ban, e.g., 123456789012345678',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for banning the member',
    },
    deleteMessageSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seconds of message history to delete, 0-604800 (7 days)',
    },
  },

  request: {
    url: (params: DiscordBanMemberParams) => {
      return `https://discord.com/api/v10/guilds/${params.serverId.trim()}/bans/${params.userId.trim()}`
    },
    method: 'PUT',
    headers: (params) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bot ${params.botToken.trim()}`,
      }
      if (params.reason) {
        headers['X-Audit-Log-Reason'] = encodeURIComponent(params.reason)
      }
      return headers
    },
    body: (params: DiscordBanMemberParams) => {
      const body: any = {}
      if (params.deleteMessageSeconds !== undefined) {
        body.delete_message_seconds = Number(params.deleteMessageSeconds)
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
