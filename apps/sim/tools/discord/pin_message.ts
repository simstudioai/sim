import type { DiscordPinMessageParams, DiscordPinMessageResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordPinMessageTool: ToolConfig<DiscordPinMessageParams, DiscordPinMessageResponse> =
  {
    id: 'discord_pin_message',
    name: 'Discord Pin Message',
    description: 'Pin a message in a Discord channel',
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
        description: 'The Discord channel ID containing the message',
      },
      messageId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the message to pin',
      },
      serverId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'The Discord server ID (guild ID)',
      },
    },

    request: {
      url: (params: DiscordPinMessageParams) => {
        return `https://discord.com/api/v10/channels/${params.channelId}/pins/${params.messageId}`
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
          message: 'Message pinned successfully',
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
    },
  }
