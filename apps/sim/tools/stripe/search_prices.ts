import { STRIPE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { PriceListResponse, SearchPricesParams } from '@/tools/stripe/types'
import { SEARCH_METADATA_OUTPUT_PROPERTIES } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeSearchPricesTool: ToolConfig<SearchPricesParams, PriceListResponse> = {
  id: 'stripe_search_prices',
  name: 'Stripe Search Prices',
  description: 'Search for prices using query syntax',
  version: '1.0.0',
  oauth: STRIPE_CREDENTIAL_OAUTH,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Search query (e.g., \"active:'true' AND currency:'usd'\")",
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 10, max 100)',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination token from metadata.next_page of the previous search; omit for the first page',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/prices/search')
      url.searchParams.append('query', params.query)
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.page) url.searchParams.append('page', params.page)
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
          next_page: data.next_page ?? null,
        },
      },
    }
  },

  outputs: {
    prices: {
      type: 'json',
      description: 'Array of matching price objects',
    },
    metadata: {
      type: 'json',
      description: 'Search metadata',

      properties: SEARCH_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
