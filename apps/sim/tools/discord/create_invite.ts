import type { DiscordCreateInviteParams, DiscordCreateInviteResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordCreateInviteTool: ToolConfig<
  DiscordCreateInviteParams,
  DiscordCreateInviteResponse
> = {
  id: 'discord_create_invite',
  name: 'Discord Create Invite',
  description: 'Create an invite link for a Discord channel',
  version: '1.0.0',

  params: {
    botToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The bot token for authentication',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord channel ID to create an invite for',
    },
    maxAge: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration of invite in seconds (0 = never expires, default 86400)',
    },
    maxUses: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max number of uses (0 = unlimited, default 0)',
    },
    temporary: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether invite grants temporary membership',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordCreateInviteParams) => {
      return `https://discord.com/api/v10/channels/${params.channelId}/invites`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bot ${params.botToken}`,
    }),
    body: (params: DiscordCreateInviteParams) => {
      const body: any = {}
      if (params.maxAge !== undefined) body.max_age = Number(params.maxAge)
      if (params.maxUses !== undefined) body.max_uses = Number(params.maxUses)
      if (params.temporary !== undefined) body.temporary = params.temporary
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Invite created successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Created invite data',
      properties: {
        code: { type: 'string', description: 'Invite code' },
        url: { type: 'string', description: 'Full invite URL' },
        max_age: { type: 'number', description: 'Max age in seconds' },
        max_uses: { type: 'number', description: 'Max uses' },
        temporary: { type: 'boolean', description: 'Whether temporary' },
      },
    },
  },
}
