import type { ToolConfig } from '@/tools/types'

export const stripeWebhookListenTool: ToolConfig = {
  id: 'stripe_webhook_listen',
  name: 'Listen for Webhook Events (Conceptual)',
  description:
    'This endpoint represents the action of receiving and processing asynchronous events from Stripe (e.g., payment success, refund). Requires setting up a webhook listener.',
  version: '1.0.0',

  params: {
    payload: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: "The raw JSON payload received from Stripe's webhook endpoint.",
    },
  },

  outputs: {
    event_type: {
      type: 'string',
      description: 'The type of event that occurred (e.g., payment_intent.succeeded).',
    },
    data: {
      type: 'json',
      description: 'The full object data associated with the event.',
      optional: true,
    },
  },

  request: {
    url: () => `https://api.stripe.com/v1/webhooks`,
    method: () => 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const { apiKey: _apiKey, ...bodyParams } = params
      return bodyParams
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      event_type: data.event_type ?? '',
      data: data.data ?? null,
    }
  },
}
