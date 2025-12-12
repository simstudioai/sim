import type { ListProductsParams, ProductListResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListProductsTool: ToolConfig<ListProductsParams, ProductListResponse> = {
  id: 'stripe_list_products',
  name: 'Stripe List Products',
  description: 'List all products',
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
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by active status',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/products')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.active !== undefined) url.searchParams.append('active', String(params.active))
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
        products: data.data || [],
        metadata: {
          count: (data.data || []).length,
          has_more: data.has_more || false,
        },
      },
    }
  },

  outputs: {
    products: {
      type: 'json',
      description: 'Array of product objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
    },
  },
}
