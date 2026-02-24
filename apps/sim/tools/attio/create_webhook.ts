import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioCreateWebhookParams, AttioCreateWebhookResponse } from './types'
import { WEBHOOK_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioCreateWebhook')

export const attioCreateWebhookTool: ToolConfig<
  AttioCreateWebhookParams,
  AttioCreateWebhookResponse
> = {
  id: 'attio_create_webhook',
  name: 'Attio Create Webhook',
  description: 'Create a webhook in Attio to receive event notifications',
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
    targetUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The HTTPS URL to receive webhook events',
    },
    subscriptions: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of subscriptions (e.g. [{"event_type":"record.created","filter":{"object_id":"..."}}])',
    },
  },

  request: {
    url: 'https://api.attio.com/v2/webhooks',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let subscriptions: unknown[] = []
      try {
        subscriptions =
          typeof params.subscriptions === 'string'
            ? JSON.parse(params.subscriptions)
            : params.subscriptions
      } catch {
        subscriptions = []
      }
      return {
        data: {
          target_url: params.targetUrl,
          subscriptions,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create webhook')
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
        secret: w.secret ?? null,
        createdAt: w.created_at ?? null,
      },
    }
  },

  outputs: {
    ...WEBHOOK_OUTPUT_PROPERTIES,
    secret: {
      type: 'string',
      description: 'The webhook signing secret (only returned on creation)',
    },
  },
}
