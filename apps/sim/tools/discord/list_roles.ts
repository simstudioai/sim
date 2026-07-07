import type { DiscordListRolesParams, DiscordListRolesResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordListRolesTool: ToolConfig<DiscordListRolesParams, DiscordListRolesResponse> = {
  id: 'discord_list_roles',
  name: 'Discord List Roles',
  description: 'List all roles in a Discord server',
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
  },

  request: {
    url: (params: DiscordListRolesParams) => {
      return `https://discord.com/api/v10/guilds/${params.serverId.trim()}/roles`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bot ${params.botToken.trim()}`,
    }),
  },

  transformResponse: async (response) => {
    const roles = await response.json()
    return {
      success: true,
      output: {
        message: `Retrieved ${roles.length} roles from Discord server`,
        data: roles,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'array',
      description: 'Array of Discord roles in the server',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Role ID' },
          name: { type: 'string', description: 'Role name' },
          color: { type: 'number', description: 'Role color' },
          hoist: { type: 'boolean', description: 'Whether role is hoisted' },
          position: { type: 'number', description: 'Role position in the hierarchy' },
          mentionable: { type: 'boolean', description: 'Whether role is mentionable' },
        },
      },
    },
  },
}
