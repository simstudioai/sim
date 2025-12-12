import type { ListPricesParams, PriceListResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListPricesTool: ToolConfig<ListPricesParams, PriceListResponse> = {
  id: 'stripe_list_prices',
  name: 'Stripe List Prices',
  description: 'List all prices',
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
    product: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by product ID',
    },
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by active status',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/prices')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.product) url.searchParams.append('product', params.product)
      if (params.active !== undefined) url.searchParams.append('active', params.active.toString())
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
        prices: data.data || [],
        metadata: {
          count: (data.data || []).length,
          has_more: data.has_more || false,
        },
      },
    }
  },

  outputs: {
    prices: {
      type: 'json',
      description: 'Array of price objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
    },
  },
}
