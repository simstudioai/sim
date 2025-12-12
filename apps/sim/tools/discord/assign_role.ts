import type { DiscordAssignRoleParams, DiscordAssignRoleResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordAssignRoleTool: ToolConfig<DiscordAssignRoleParams, DiscordAssignRoleResponse> =
  {
    id: 'discord_assign_role',
    name: 'Discord Assign Role',
    description: 'Assign a role to a member in a Discord server',
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
        description: 'The user ID to assign the role to',
      },
      roleId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The role ID to assign',
      },
    },

    request: {
      url: (params: DiscordAssignRoleParams) => {
        return `https://discord.com/api/v10/guilds/${params.serverId}/members/${params.userId}/roles/${params.roleId}`
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
          message: 'Role assigned successfully',
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
    },
  }
