import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioUpdateWebhookParams, AttioUpdateWebhookResponse } from './types'
import { WEBHOOK_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioUpdateWebhook')

export const attioUpdateWebhookTool: ToolConfig<
  AttioUpdateWebhookParams,
  AttioUpdateWebhookResponse
> = {
  id: 'attio_update_webhook',
  name: 'Attio Update Webhook',
  description: 'Update a webhook in Attio (target URL and/or subscriptions)',
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
    webhookId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The webhook ID to update',
    },
    targetUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New HTTPS target URL',
    },
    subscriptions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New JSON array of subscriptions',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/webhooks/${params.webhookId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const data: Record<string, unknown> = {}
      if (params.targetUrl !== undefined) data.target_url = params.targetUrl
      if (params.subscriptions) {
        try {
          data.subscriptions =
            typeof params.subscriptions === 'string'
              ? JSON.parse(params.subscriptions)
              : params.subscriptions
        } catch {
          data.subscriptions = []
        }
      }
      return { data }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to update webhook')
    }
    const w = data.data
    const subs =
      (w.subscriptions as Array<{ event_type?: string; filter?: unknown }>)?.map(
        (s: { event_type?: string; filter?: unknown }) => ({
          eventType: s.event_type ?? null,
          filter: s.filter ?? null,
        })
      ) ?? []
    return {
      success: true,
      output: {
        webhookId: w.id?.webhook_id ?? null,
        targetUrl: w.target_url ?? null,
        subscriptions: subs,
        status: w.status ?? null,
        createdAt: w.created_at ?? null,
      },
    }
  },

  outputs: WEBHOOK_OUTPUT_PROPERTIES,
}
