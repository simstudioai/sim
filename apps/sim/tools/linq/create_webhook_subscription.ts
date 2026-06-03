import type {
  LinqCreateWebhookSubscriptionParams,
  LinqCreateWebhookSubscriptionResult,
} from '@/tools/linq/types'
import {
  extractLinqError,
  LINQ_API_BASE,
  linqHeaders,
  mapWebhookSubscription,
} from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqCreateWebhookSubscriptionTool: ToolConfig<
  LinqCreateWebhookSubscriptionParams,
  LinqCreateWebhookSubscriptionResult
> = {
  id: 'linq_create_webhook_subscription',
  name: 'Create Webhook Subscription',
  description: 'Subscribe an HTTPS endpoint to Linq webhook events',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    targetUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'HTTPS endpoint that will receive webhook events',
    },
    subscribedEvents: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event types to subscribe to (e.g. message.sent, message.delivered)',
    },
    phoneNumbers: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'E.164 phone numbers to filter events by (omit for all numbers)',
    },
  },

  request: {
    url: `${LINQ_API_BASE}/webhook-subscriptions`,
    method: 'POST',
    headers: (params) => linqHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        target_url: params.targetUrl,
        subscribed_events: params.subscribedEvents,
      }
      if (params.phoneNumbers && params.phoneNumbers.length > 0) {
        body.phone_numbers = params.phoneNumbers
      }
      return body
    },
  },

  transformResponse: async (response): Promise<LinqCreateWebhookSubscriptionResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to create webhook subscription'),
        output: {
          id: '',
          targetUrl: '',
          subscribedEvents: [],
          phoneNumbers: null,
          isActive: false,
          createdAt: null,
          updatedAt: null,
          signingSecret: '',
        },
      }
    }

    return {
      success: true,
      output: {
        ...mapWebhookSubscription(data),
        signingSecret: data.signing_secret ?? '',
      },
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
    signingSecret: {
      type: 'string',
      description: 'HMAC-SHA256 signing secret. Store securely — it cannot be retrieved again',
    },
  },
}
