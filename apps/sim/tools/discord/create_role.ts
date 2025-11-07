import type { DiscordCreateRoleParams, DiscordCreateRoleResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordCreateRoleTool: ToolConfig<DiscordCreateRoleParams, DiscordCreateRoleResponse> =
  {
    id: 'discord_create_role',
    name: 'Discord Create Role',
    description: 'Create a new role in a Discord server',
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
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The name of the role',
      },
      color: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'RGB color value as integer (e.g., 0xFF0000 for red)',
      },
      hoist: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to display role members separately from online members',
      },
      mentionable: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether the role can be mentioned',
      },
    },

    request: {
      url: (params: DiscordCreateRoleParams) => {
        return `https://discord.com/api/v10/guilds/${params.serverId}/roles`
      },
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bot ${params.botToken}`,
      }),
      body: (params: DiscordCreateRoleParams) => {
        const body: any = {
          name: params.name,
        }
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
          message: 'Role created successfully',
          data,
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
      data: {
        type: 'object',
        description: 'Created role data',
        properties: {
          id: { type: 'string', description: 'Role ID' },
          name: { type: 'string', description: 'Role name' },
          color: { type: 'number', description: 'Role color' },
          hoist: { type: 'boolean', description: 'Whether role is hoisted' },
          mentionable: { type: 'boolean', description: 'Whether role is mentionable' },
        },
      },
    },
  }
