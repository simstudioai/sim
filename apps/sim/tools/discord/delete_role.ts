import type { DiscordDeleteRoleParams, DiscordDeleteRoleResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordDeleteRoleTool: ToolConfig<DiscordDeleteRoleParams, DiscordDeleteRoleResponse> =
  {
    id: 'discord_delete_role',
    name: 'Discord Delete Role',
    description: 'Delete a role from a Discord server',
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
      roleId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The role ID to delete',
      },
    },

    request: {
      url: (params: DiscordDeleteRoleParams) => {
        return `https://discord.com/api/v10/guilds/${params.serverId}/roles/${params.roleId}`
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
          message: 'Role deleted successfully',
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
    },
  }
