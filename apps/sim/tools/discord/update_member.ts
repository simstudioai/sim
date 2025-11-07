import type { DiscordUpdateMemberParams, DiscordUpdateMemberResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordUpdateMemberTool: ToolConfig<
  DiscordUpdateMemberParams,
  DiscordUpdateMemberResponse
> = {
  id: 'discord_update_member',
  name: 'Discord Update Member',
  description: 'Update a member in a Discord server (e.g., change nickname)',
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
      description: 'The user ID to update',
    },
    nick: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New nickname for the member (null to remove)',
    },
    mute: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to mute the member in voice channels',
    },
    deaf: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to deafen the member in voice channels',
    },
  },

  request: {
    url: (params: DiscordUpdateMemberParams) => {
      return `https://discord.com/api/v10/guilds/${params.serverId}/members/${params.userId}`
    },
    method: 'PATCH',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bot ${params.botToken}`,
    }),
    body: (params: DiscordUpdateMemberParams) => {
      const body: any = {}
      // Note: nick can be null to remove nickname, so we allow null but not empty string
      if (params.nick !== undefined && params.nick !== '') body.nick = params.nick
      if (params.mute !== undefined && params.mute !== null) body.mute = params.mute
      if (params.deaf !== undefined && params.deaf !== null) body.deaf = params.deaf
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Member updated successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Updated member data',
      properties: {
        nick: { type: 'string', description: 'Server nickname' },
        mute: { type: 'boolean', description: 'Voice mute status' },
        deaf: { type: 'boolean', description: 'Voice deaf status' },
      },
    },
  },
}
