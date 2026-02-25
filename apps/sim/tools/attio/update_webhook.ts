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
      required: true,
      visibility: 'user-or-llm',
      description: 'HTTPS target URL for webhook delivery',
    },
    subscriptions: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of subscriptions, e.g. [{"event_type":"note.created"}]',
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
      let subscriptions: unknown = []
      if (params.subscriptions) {
        try {
          subscriptions =
            typeof params.subscriptions === 'string'
              ? JSON.parse(params.subscriptions)
              : params.subscriptions
        } catch {
          subscriptions = []
        }
      }
      const data: Record<string, unknown> = {
        target_url: params.targetUrl,
        subscriptions,
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
