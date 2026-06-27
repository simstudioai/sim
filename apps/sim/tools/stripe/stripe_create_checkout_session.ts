import type { ToolConfig } from '@/tools/types'

export const stripeCreateCheckoutSessionTool: ToolConfig = {
  id: 'stripe_create_checkout_session',
  name: 'Create Checkout Session Link',
  description: 'Generates a secure, hosted payment link for one-time purchases or subscriptions. This is the recommended method for front-end payments.',
  version: '1.0.0',

  params: {
    mode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The session mode (payment, subscription, or setup).',
    },
    success_url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL to redirect the user to upon successful payment.',
    },
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Unique session ID.',
    },
    client_secret: {
      type: 'string',
      description: 'Secret key required to complete the payment client-side.',
    },
  },

  request: {
    url: () => `https://api.stripe.com//v1/checkout/sessions`,
    method: () => 'POST',
    headers: (params) => ({
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const { apiKey, ...bodyParams } = params
      return bodyParams
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      id: data.id ?? '',
      client_secret: data.client_secret ?? '',
    }
  },
}
