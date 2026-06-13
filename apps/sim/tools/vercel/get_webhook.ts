import type { ToolConfig } from '@/tools/types'
import type { VercelGetWebhookParams, VercelGetWebhookResponse } from '@/tools/vercel/types'

export const vercelGetWebhookTool: ToolConfig<VercelGetWebhookParams, VercelGetWebhookResponse> = {
  id: 'vercel_get_webhook',
  name: 'Vercel Get Webhook',
  description: 'Get details about a specific Vercel webhook',
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
      description: 'Webhook ID to look up',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelGetWebhookParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/webhooks/${params.webhookId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetWebhookParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? null,
        url: data.url ?? null,
        events: data.events ?? [],
        ownerId: data.ownerId ?? null,
        projectIds: data.projectIds ?? [],
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Webhook ID',
    },
    url: {
      type: 'string',
      description: 'Webhook URL',
    },
    events: {
      type: 'array',
      description: 'Events the webhook listens to',
      items: { type: 'string', description: 'Event name' },
    },
    ownerId: {
      type: 'string',
      description: 'Owner ID',
    },
    projectIds: {
      type: 'array',
      description: 'Associated project IDs',
      optional: true,
      items: { type: 'string', description: 'Project ID' },
    },
    createdAt: {
      type: 'number',
      description: 'Creation timestamp',
    },
    updatedAt: {
      type: 'number',
      description: 'Last updated timestamp',
    },
  },
}
