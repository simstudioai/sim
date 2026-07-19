import type { ToolConfig } from '@/tools/types'

export const stripeCreateChargeTool: ToolConfig = {
  id: 'stripe_create_charge',
  name: 'Create a Payment Charge',
  description:
    'Creates a charge on behalf of a customer using various payment methods (card, bank account). Use this when you need immediate funds capture.',
  version: '1.0.0',

  params: {
    amount: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The amount to charge in cents (integer).',
    },
    currency: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Three-letter ISO currency code (e.g., usd, eur).',
    },
    source: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'The payment source token or ID.',
    },
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Unique identifier for the charge.',
    },
    status: {
      type: 'string',
      description: 'The current status of the charge (e.g., succeeded, failed).',
    },
  },

  request: {
    url: () => `https://api.stripe.com/v1/charges`,
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
