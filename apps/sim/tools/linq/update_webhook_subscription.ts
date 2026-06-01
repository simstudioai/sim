import type {
  LinqUpdateWebhookSubscriptionParams,
  LinqWebhookSubscriptionResult,
} from '@/tools/linq/types'
import {
  extractLinqError,
  LINQ_API_BASE,
  linqHeaders,
  mapWebhookSubscription,
} from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqUpdateWebhookSubscriptionTool: ToolConfig<
  LinqUpdateWebhookSubscriptionParams,
  LinqWebhookSubscriptionResult
> = {
  id: 'linq_update_webhook_subscription',
  name: 'Update Webhook Subscription',
  description: 'Update a webhook subscription (target URL, events, phone filter, or active state)',
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
    targetUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New HTTPS endpoint that will receive events',
    },
    subscribedEvents: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'New set of event types to subscribe to',
    },
    phoneNumbers: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'New set of E.164 phone numbers to filter by',
    },
    isActive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the subscription should be active',
    },
  },

  request: {
    url: (params) =>
      `${LINQ_API_BASE}/webhook-subscriptions/${encodeURIComponent(params.subscriptionId.trim())}`,
    method: 'PUT',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.targetUrl !== undefined) body.target_url = params.targetUrl
      if (params.subscribedEvents !== undefined) body.subscribed_events = params.subscribedEvents
      if (params.phoneNumbers !== undefined) body.phone_numbers = params.phoneNumbers
      if (params.isActive !== undefined) body.is_active = params.isActive
      return body
    },
  },

  transformResponse: async (response): Promise<LinqWebhookSubscriptionResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to update webhook subscription'),
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
