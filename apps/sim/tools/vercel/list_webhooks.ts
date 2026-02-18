import type { ToolConfig } from '@/tools/types'
import type { VercelListWebhooksParams, VercelListWebhooksResponse } from '@/tools/vercel/types'

export const vercelListWebhooksTool: ToolConfig<
  VercelListWebhooksParams,
  VercelListWebhooksResponse
> = {
  id: 'vercel_list_webhooks',
  name: 'Vercel List Webhooks',
  description: 'List webhooks for a Vercel project or team',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter webhooks by project ID',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelListWebhooksParams) => {
      const query = new URLSearchParams()
      if (params.projectId) query.set('projectId', params.projectId.trim())
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/webhooks${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelListWebhooksParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const webhooks = (Array.isArray(data) ? data : []).map((w: any) => ({
      id: w.id ?? null,
      url: w.url ?? null,
      events: w.events ?? [],
      ownerId: w.ownerId ?? null,
      projectIds: w.projectIds ?? [],
      createdAt: w.createdAt ?? null,
      updatedAt: w.updatedAt ?? null,
    }))

    return {
      success: true,
      output: {
        webhooks,
        count: webhooks.length,
      },
    }
  },

  outputs: {
    webhooks: {
      type: 'array',
      description: 'List of webhooks',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Webhook ID' },
          url: { type: 'string', description: 'Webhook URL' },
          events: {
            type: 'array',
            description: 'Events the webhook listens to',
            items: { type: 'string', description: 'Event name' },
          },
          ownerId: { type: 'string', description: 'Owner ID' },
          projectIds: {
            type: 'array',
            description: 'Associated project IDs',
            items: { type: 'string', description: 'Project ID' },
          },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last updated timestamp' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of webhooks returned',
    },
  },
}
