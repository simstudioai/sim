import type { DiscordGetWebhookParams, DiscordGetWebhookResponse } from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordGetWebhookTool: ToolConfig<DiscordGetWebhookParams, DiscordGetWebhookResponse> =
  {
    id: 'discord_get_webhook',
    name: 'Discord Get Webhook',
    description: 'Get information about a Discord webhook',
    version: '1.0.0',

    params: {
      botToken: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'The bot token for authentication',
      },
      webhookId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'The webhook ID to retrieve',
      },
      serverId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'The Discord server ID (guild ID)',
      },
    },

    request: {
      url: (params: DiscordGetWebhookParams) => {
        return `https://discord.com/api/v10/webhooks/${params.webhookId}`
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
          message: 'Webhook information retrieved successfully',
          data,
        },
      }
    },

    outputs: {
      message: { type: 'string', description: 'Success or error message' },
      data: {
        type: 'object',
        description: 'Webhook data',
        properties: {
          id: { type: 'string', description: 'Webhook ID' },
          name: { type: 'string', description: 'Webhook name' },
          channel_id: { type: 'string', description: 'Channel ID' },
          guild_id: { type: 'string', description: 'Server ID' },
          token: { type: 'string', description: 'Webhook token' },
        },
      },
    },
  }
