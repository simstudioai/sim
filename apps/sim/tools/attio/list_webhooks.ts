import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioListWebhooksParams, AttioListWebhooksResponse } from './types'
import { WEBHOOK_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioListWebhooks')

export const attioListWebhooksTool: ToolConfig<AttioListWebhooksParams, AttioListWebhooksResponse> =
  {
    id: 'attio_list_webhooks',
    name: 'Attio List Webhooks',
    description: 'List all webhooks in the Attio workspace',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'attio',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'The OAuth access token for the Attio API',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of webhooks to return',
      },
      offset: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of webhooks to skip for pagination',
      },
    },

    request: {
      url: (params) => {
        const searchParams = new URLSearchParams()
        if (params.limit != null) searchParams.set('limit', String(params.limit))
        if (params.offset != null) searchParams.set('offset', String(params.offset))
        const qs = searchParams.toString()
        return `https://api.attio.com/v2/webhooks${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!response.ok) {
        logger.error('Attio API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to list webhooks')
      }
      const webhooks = (data.data ?? []).map((w: Record<string, unknown>) => {
        const id = w.id as { webhook_id?: string } | undefined
        const subs =
          (w.subscriptions as Array<{ event_type?: string; filter?: unknown }>)?.map((s) => ({
            eventType: s.event_type ?? null,
            filter: s.filter ?? null,
          })) ?? []
        return {
          webhookId: id?.webhook_id ?? null,
          targetUrl: (w.target_url as string) ?? null,
          subscriptions: subs,
          status: (w.status as string) ?? null,
          createdAt: (w.created_at as string) ?? null,
        }
      })
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
        description: 'Array of webhooks',
        items: {
          type: 'object',
          properties: WEBHOOK_OUTPUT_PROPERTIES,
        },
      },
      count: { type: 'number', description: 'Number of webhooks returned' },
    },
  }
