import type {
  DiscordDeleteWebhookParams,
  DiscordDeleteWebhookResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordDeleteWebhookTool: ToolConfig<
  DiscordDeleteWebhookParams,
  DiscordDeleteWebhookResponse
> = {
  id: 'discord_delete_webhook',
  name: 'Discord Delete Webhook',
  description: 'Delete a Discord webhook',
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
      visibility: 'user-or-llm',
      description: 'The webhook ID to delete',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordDeleteWebhookParams) => {
      return `https://discord.com/api/v10/webhooks/${params.webhookId}`
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
        message: 'Webhook deleted successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
  },
}
