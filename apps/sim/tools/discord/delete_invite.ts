import type { DiscordDeleteInviteParams, DiscordDeleteInviteResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordDeleteInviteTool: ToolConfig<
  DiscordDeleteInviteParams,
  DiscordDeleteInviteResponse
> = {
  id: 'discord_delete_invite',
  name: 'Discord Delete Invite',
  description: 'Delete a Discord invite',
  version: '1.0.0',

  params: {
    botToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The bot token for authentication',
    },
    inviteCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The invite code to delete',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordDeleteInviteParams) => {
      return `https://discord.com/api/v10/invites/${params.inviteCode}`
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
        message: 'Invite deleted successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
