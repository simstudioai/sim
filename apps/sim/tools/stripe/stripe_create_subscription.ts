import type { ToolConfig } from '@/tools/types'

export const stripeCreateSubscriptionTool: ToolConfig = {
  id: 'stripe_create_subscription',
  name: 'Create Recurring Subscription',
  description:
    'Sets up a recurring billing cycle for a customer using a specific price ID. Essential for SaaS models.',
  version: '1.0.0',

  params: {
    customer: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Stripe Customer ID to subscribe.',
    },
    price: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Price ID defining the recurring cost (e.g., $10/month).',
    },
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Unique subscription ID.',
    },
    status: {
      type: 'string',
      description: 'Current status (e.g., active, past_due).',
    },
  },

  request: {
    url: () => `https://api.stripe.com/v1/subscriptions`,
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
      id: data.id ?? '',
      status: data.status ?? '',
    }
  },
}
