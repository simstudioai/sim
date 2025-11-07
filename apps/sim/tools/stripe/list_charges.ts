import type { ChargeListResponse, ListChargesParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListChargesTool: ToolConfig<ListChargesParams, ChargeListResponse> = {
  id: 'stripe_list_charges',
  name: 'Stripe List Charges',
  description: 'List all charges',
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
      const url = new URL('https://api.stripe.com/v1/charges')
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
        charges: data.data || [],
        metadata: {
          count: (data.data || []).length,
          has_more: data.has_more || false,
        },
      },
    }
  },

  outputs: {
    charges: {
      type: 'json',
      description: 'Array of Charge objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata including count and has_more',
    },
  },
}
