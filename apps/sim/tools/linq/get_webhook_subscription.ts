import type {
  LinqGetWebhookSubscriptionParams,
  LinqWebhookSubscriptionResult,
} from '@/tools/linq/types'
import {
  extractLinqError,
  LINQ_API_BASE,
  linqHeaders,
  mapWebhookSubscription,
} from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqGetWebhookSubscriptionTool: ToolConfig<
  LinqGetWebhookSubscriptionParams,
  LinqWebhookSubscriptionResult
> = {
  id: 'linq_get_webhook_subscription',
  name: 'Get Webhook Subscription',
  description: 'Retrieve a webhook subscription by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    subscriptionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the webhook subscription',
    },
  },

  request: {
    url: (params) =>
      `${LINQ_API_BASE}/webhook-subscriptions/${encodeURIComponent(params.subscriptionId.trim())}`,
    method: 'GET',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqWebhookSubscriptionResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to get webhook subscription'),
        output: {
          id: '',
          targetUrl: '',
          subscribedEvents: [],
          phoneNumbers: null,
          isActive: false,
          createdAt: null,
          updatedAt: null,
        },
      }
    }

    return {
      success: true,
      output: mapWebhookSubscription(data),
    }
  },

  outputs: {
    id: { type: 'string', description: 'Subscription ID' },
    targetUrl: { type: 'string', description: 'Endpoint that receives events' },
    subscribedEvents: { type: 'json', description: 'Subscribed event types' },
    phoneNumbers: {
      type: 'json',
      description: 'Filtered phone numbers (null = all)',
      optional: true,
    },
    isActive: { type: 'boolean', description: 'Whether the subscription is active' },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', optional: true },
    updatedAt: { type: 'string', description: 'ISO 8601 update timestamp', optional: true },
  },
}
