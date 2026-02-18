import type { ToolConfig } from '@/tools/types'
import type { VercelDeleteWebhookParams, VercelDeleteWebhookResponse } from '@/tools/vercel/types'

export const vercelDeleteWebhookTool: ToolConfig<
  VercelDeleteWebhookParams,
  VercelDeleteWebhookResponse
> = {
  id: 'vercel_delete_webhook',
  name: 'Vercel Delete Webhook',
  description: 'Delete a webhook from a Vercel team',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    webhookId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The webhook ID to delete',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelDeleteWebhookParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/webhooks/${params.webhookId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'DELETE',
    headers: (params: VercelDeleteWebhookParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async () => {
    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the webhook was successfully deleted',
    },
  },
}
