import type { DiscordUpdateRoleParams, DiscordUpdateRoleResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordUpdateRoleTool: ToolConfig<DiscordUpdateRoleParams, DiscordUpdateRoleResponse> =
  {
    id: 'discord_update_role',
    name: 'Discord Update Role',
    description: 'Update a role in a Discord server',
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
        description: 'The role ID to update',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The new name for the role',
      },
      color: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'RGB color value as integer',
      },
      hoist: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to display role members separately',
      },
      mentionable: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the role can be mentioned',
      },
    },

    request: {
      url: (params: DiscordUpdateRoleParams) => {
        return `https://discord.com/api/v10/guilds/${params.serverId}/roles/${params.roleId}`
      },
      method: 'PATCH',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bot ${params.botToken}`,
      }),
      body: (params: DiscordUpdateRoleParams) => {
        const body: any = {}
        if (params.name) body.name = params.name
        if (params.color !== undefined) body.color = Number(params.color)
        if (params.hoist !== undefined) body.hoist = params.hoist
        if (params.mentionable !== undefined) body.mentionable = params.mentionable
        return body
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()
      return {
        success: true,
        output: {
          message: 'Role updated successfully',
          data,
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
      data: {
        type: 'object',
        description: 'Updated role data',
        properties: {
          id: { type: 'string', description: 'Role ID' },
          name: { type: 'string', description: 'Role name' },
          color: { type: 'number', description: 'Role color' },
        },
      },
    },
  }
