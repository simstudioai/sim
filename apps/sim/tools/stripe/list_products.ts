import { STRIPE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ListProductsParams, ProductListResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListProductsTool: ToolConfig<ListProductsParams, ProductListResponse> = {
  id: 'stripe_list_products',
  name: 'Stripe List Products',
  description: 'List all products',
  version: '1.0.0',
  oauth: STRIPE_CREDENTIAL_OAUTH,

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
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Next-page cursor: last product ID from the previous page. Do not combine with ending_before.',
    },
    ending_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Previous-page cursor: first product ID from the current page. Do not combine with starting_after.',
    },
  },

  request: {
    url: (params) => {
      if (params.starting_after && params.ending_before) {
        throw new Error('Provide either starting_after or ending_before, not both')
      }
      const url = new URL('https://api.stripe.com/v1/products')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.starting_after) url.searchParams.append('starting_after', params.starting_after)
      if (params.ending_before) url.searchParams.append('ending_before', params.ending_before)
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

      properties: {
        count: { type: 'number', description: 'Number of items returned' },
        has_more: { type: 'boolean', description: 'Whether more items exist beyond this page' },
      },
    },
  },
}
