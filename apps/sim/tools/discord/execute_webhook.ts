import type {
  DiscordExecuteWebhookParams,
  DiscordExecuteWebhookResponse,
} from '@/tools/discord/types'
import type { ToolConfig } from '@/tools/types'

export const discordExecuteWebhookTool: ToolConfig<
  DiscordExecuteWebhookParams,
  DiscordExecuteWebhookResponse
> = {
  id: 'discord_execute_webhook',
  name: 'Discord Execute Webhook',
  description: 'Execute a Discord webhook to send a message',
  version: '1.0.0',

  params: {
    webhookId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The webhook ID',
    },
    webhookToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The webhook token',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The message content to send',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Override the default username of the webhook',
    },
    serverId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Discord server ID (guild ID)',
    },
  },

  request: {
    url: (params: DiscordExecuteWebhookParams) => {
      return `https://discord.com/api/v10/webhooks/${params.webhookId}/${params.webhookToken}?wait=true`
    },
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: DiscordExecuteWebhookParams) => {
      const body: any = {
        content: params.content,
      }
      if (params.username) body.username = params.username
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Webhook executed successfully',
        data,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or error message' },
    data: {
      type: 'object',
      description: 'Message sent via webhook',
      properties: {
        id: { type: 'string', description: 'Message ID' },
        content: { type: 'string', description: 'Message content' },
        channel_id: { type: 'string', description: 'Channel ID' },
        timestamp: { type: 'string', description: 'Message timestamp' },
      },
    },
  },
}
