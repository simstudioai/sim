import Stripe from 'stripe'
import type { PriceListResponse, SearchPricesParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeSearchPricesTool: ToolConfig<SearchPricesParams, PriceListResponse> = {
  id: 'stripe_search_prices',
  name: 'Stripe Search Prices',
  description: 'Search for prices using query syntax',
  version: '1.0.0',

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
  },

  directExecution: async (params) => {
    try {
      const stripe = new Stripe(params.apiKey, { apiVersion: '2025-08-27.basil' })
      const searchOptions: Stripe.PriceSearchParams = { query: params.query }
      if (params.limit) searchOptions.limit = params.limit
      const searchResult = await stripe.prices.search(searchOptions)
      return {
        success: true,
        output: {
          prices: searchResult.data || [],
          metadata: { count: searchResult.data.length, has_more: searchResult.has_more || false },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `STRIPE_SEARCH_PRICES_ERROR: Failed to search prices - ${errorDetails}`,
      }
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
    },
  },
}
