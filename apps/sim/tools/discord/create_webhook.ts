import type {
  DiscordCreateWebhookParams,
  DiscordCreateWebhookResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordCreateWebhookTool: ToolConfig<
  DiscordCreateWebhookParams,
  DiscordCreateWebhookResponse
> = {
  id: 'discord_create_webhook',
  name: 'Discord Create Webhook',
  description: 'Create a webhook in a Discord channel',
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
      description: 'The Discord channel ID to create the webhook in',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the webhook (1-80 characters)',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordCreateWebhookParams) => {
      return `https://discord.com/api/v10/channels/${params.channelId}/webhooks`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bot ${params.botToken}`,
    }),
    body: (params: DiscordCreateWebhookParams) => {
      return {
        name: params.name,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Webhook created successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Created webhook data',
      properties: {
        id: { type: 'string', description: 'Webhook ID' },
        name: { type: 'string', description: 'Webhook name' },
        token: { type: 'string', description: 'Webhook token' },
        url: { type: 'string', description: 'Webhook URL' },
        channel_id: { type: 'string', description: 'Channel ID' },
      },
    },
  },
}
