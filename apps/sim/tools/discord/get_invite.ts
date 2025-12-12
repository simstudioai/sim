import type { DiscordGetInviteParams, DiscordGetInviteResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordGetInviteTool: ToolConfig<DiscordGetInviteParams, DiscordGetInviteResponse> = {
  id: 'discord_get_invite',
  name: 'Discord Get Invite',
  description: 'Get information about a Discord invite',
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
      description: 'The invite code to retrieve',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordGetInviteParams) => {
      return `https://discord.com/api/v10/invites/${params.inviteCode}?with_counts=true`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bot ${params.botToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Invite information retrieved successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Invite data',
      properties: {
        code: { type: 'string', description: 'Invite code' },
        guild: { type: 'object', description: 'Server information' },
        channel: { type: 'object', description: 'Channel information' },
        approximate_member_count: { type: 'number', description: 'Approximate member count' },
        approximate_presence_count: { type: 'number', description: 'Approximate online count' },
      },
    },
  },
}
