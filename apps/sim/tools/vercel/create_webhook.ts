import type { ToolConfig } from '@/tools/types'
import type { VercelCreateWebhookParams, VercelCreateWebhookResponse } from '@/tools/vercel/types'

export const vercelCreateWebhookTool: ToolConfig<
  VercelCreateWebhookParams,
  VercelCreateWebhookResponse
> = {
  id: 'vercel_create_webhook',
  name: 'Vercel Create Webhook',
  description: 'Create a new webhook for a Vercel team',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Webhook URL (must be https)',
    },
    events: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated event names to subscribe to',
    },
    projectIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated project IDs to scope the webhook to',
    },
    teamId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Team ID to create the webhook for',
    },
  },

  request: {
    url: (params: VercelCreateWebhookParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/webhooks${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelCreateWebhookParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelCreateWebhookParams) => {
      const body: Record<string, any> = {
        url: params.url.trim(),
        events: params.events.split(',').map((e) => e.trim()),
      }
      if (params.projectIds) {
        body.projectIds = params.projectIds.split(',').map((p) => p.trim())
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id ?? null,
        url: data.url ?? null,
        secret: data.secret ?? null,
        events: data.events ?? [],
        ownerId: data.ownerId ?? null,
        projectIds: data.projectIds ?? [],
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Webhook ID' },
    url: { type: 'string', description: 'Webhook URL' },
    secret: { type: 'string', description: 'Webhook signing secret' },
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
}
