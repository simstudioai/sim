import type { CreatePriceParams, PriceResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeCreatePriceTool: ToolConfig<CreatePriceParams, PriceResponse> = {
  id: 'stripe_create_price',
  name: 'Stripe Create Price',
  description: 'Create a new price for a product',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    product: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Product ID (e.g., prod_1234567890)',
    },
    currency: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Three-letter ISO currency code (e.g., usd, eur)',
    },
    unit_amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount in cents (e.g., 1000 for $10.00)',
    },
    recurring: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recurring billing configuration (interval: day/week/month/year)',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs',
    },
    billing_scheme: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing scheme (per_unit or tiered)',
    },
  },

  request: {
    url: () => 'https://api.stripe.com/v1/prices',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      formData.append('product', params.product)
      formData.append('currency', params.currency)

      if (params.unit_amount !== undefined)
        formData.append('unit_amount', Number(params.unit_amount).toString())
      if (params.billing_scheme) formData.append('billing_scheme', params.billing_scheme)

      if (params.recurring) {
        Object.entries(params.recurring).forEach(([key, value]) => {
          if (value) formData.append(`recurring[${key}]`, String(value))
        })
      }

      if (params.metadata) {
        Object.entries(params.metadata).forEach(([key, value]) => {
          formData.append(`metadata[${key}]`, String(value))
        })
      }

      return { body: formData.toString() }
    },
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
      description: 'The created price object',
    },
    metadata: {
      type: 'json',
      description: 'Price metadata',
    },
  },
}
