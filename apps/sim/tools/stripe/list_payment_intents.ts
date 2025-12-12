import type { ListPaymentIntentsParams, PaymentIntentListResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListPaymentIntentsTool: ToolConfig<
  ListPaymentIntentsParams,
  PaymentIntentListResponse
> = {
  id: 'stripe_list_payment_intents',
  name: 'Stripe List Payment Intents',
  description: 'List all Payment Intents',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 10, max 100)',
    },
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by customer ID',
    },
    created: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by creation date (e.g., {"gt": 1633024800})',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/payment_intents')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.customer) url.searchParams.append('customer', params.customer)
      if (params.created) {
        Object.entries(params.created).forEach(([key, value]) => {
          url.searchParams.append(`created[${key}]`, String(value))
        })
      }
      return url.toString()
    },
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
        payment_intents: data.data || [],
        metadata: {
          count: (data.data || []).length,
          has_more: data.has_more || false,
        },
      },
    }
  },

  outputs: {
    payment_intents: {
      type: 'json',
      description: 'Array of Payment Intent objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata including count and has_more',
    },
  },
}
