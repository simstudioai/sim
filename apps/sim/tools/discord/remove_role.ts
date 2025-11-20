import type { DiscordRemoveRoleParams, DiscordRemoveRoleResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordRemoveRoleTool: ToolConfig<DiscordRemoveRoleParams, DiscordRemoveRoleResponse> =
  {
    id: 'discord_remove_role',
    name: 'Discord Remove Role',
    description: 'Remove a role from a member in a Discord server',
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
        description: 'The user ID to remove the role from',
      },
      roleId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The role ID to remove',
      },
    },

    request: {
      url: (params: DiscordRemoveRoleParams) => {
        return `https://discord.com/api/v10/guilds/${params.serverId}/members/${params.userId}/roles/${params.roleId}`
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
          message: 'Role removed successfully',
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
    },
  }
