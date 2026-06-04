import type {
  LinqListWebhookSubscriptionsParams,
  LinqListWebhookSubscriptionsResult,
} from '@/tools/linq/types'
import {
  extractLinqError,
  LINQ_API_BASE,
  linqHeaders,
  mapWebhookSubscription,
} from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqListWebhookSubscriptionsTool: ToolConfig<
  LinqListWebhookSubscriptionsParams,
  LinqListWebhookSubscriptionsResult
> = {
  id: 'linq_list_webhook_subscriptions',
  name: 'List Webhook Subscriptions',
  description: 'List all webhook subscriptions on your account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
  },

  request: {
    url: `${LINQ_API_BASE}/webhook-subscriptions`,
    method: 'GET',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqListWebhookSubscriptionsResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to list webhook subscriptions'),
        output: { subscriptions: [] },
      }
    }

    return {
      success: true,
      output: {
        subscriptions: (data.subscriptions ?? []).map(mapWebhookSubscription),
      },
    }
  },

  outputs: {
    subscriptions: {
      type: 'array',
      description: 'Webhook subscriptions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Subscription ID' },
          targetUrl: { type: 'string', description: 'Endpoint that receives events' },
          subscribedEvents: { type: 'json', description: 'Subscribed event types' },
          phoneNumbers: { type: 'json', description: 'Filtered phone numbers (null = all)' },
          isActive: { type: 'boolean', description: 'Whether the subscription is active' },
          createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
          updatedAt: { type: 'string', description: 'ISO 8601 update timestamp' },
        },
      },
    },
  },
}
