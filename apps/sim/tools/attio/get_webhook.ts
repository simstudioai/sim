import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetWebhookParams, AttioGetWebhookResponse } from './types'
import { WEBHOOK_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioGetWebhook')

export const attioGetWebhookTool: ToolConfig<AttioGetWebhookParams, AttioGetWebhookResponse> = {
  id: 'attio_get_webhook',
  name: 'Attio Get Webhook',
  description: 'Get a single webhook by ID from Attio',
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
      description: 'The webhook ID',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/webhooks/${params.webhookId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get webhook')
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
