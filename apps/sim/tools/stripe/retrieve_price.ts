import type { PriceResponse, RetrievePriceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeRetrievePriceTool: ToolConfig<RetrievePriceParams, PriceResponse> = {
  id: 'stripe_retrieve_price',
  name: 'Stripe Retrieve Price',
  description: 'Retrieve an existing price by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Price ID (e.g., price_1234567890)',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/prices/${params.id}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        price: data,
        metadata: {
          id: data.id,
          product: data.product,
          unit_amount: data.unit_amount,
          currency: data.currency,
        },
      },
    }
  },

  outputs: {
    price: {
      type: 'json',
      description: 'The retrieved price object',
    },
    metadata: {
      type: 'json',
      description: 'Price metadata',
    },
  },
}
