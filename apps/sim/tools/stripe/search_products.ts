import Stripe from 'stripe'
import type { ProductListResponse, SearchProductsParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeSearchProductsTool: ToolConfig<SearchProductsParams, ProductListResponse> = {
  id: 'stripe_search_products',
  name: 'Stripe Search Products',
  description: 'Search for products using query syntax',
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
      description: 'Search query (e.g., "name:\'shirt\'")',
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
      const stripe = new Stripe(params.apiKey, { apiVersion: '2024-12-18.acacia' })
      const searchOptions: Stripe.ProductSearchParams = { query: params.query }
      if (params.limit) searchOptions.limit = params.limit
      const searchResult = await stripe.products.search(searchOptions)
      return {
        success: true,
        output: {
          products: searchResult.data || [],
          metadata: { count: searchResult.data.length, has_more: searchResult.has_more || false },
        },
      }
    } catch (error: any) {
      return { success: false, error: { code: 'STRIPE_SEARCH_PRODUCTS_ERROR', message: error.message || 'Failed to search products', details: error } }
    }
  },

  outputs: {
    products: {
      type: 'json',
      description: 'Array of matching product objects',
    },
    metadata: {
      type: 'json',
      description: 'Search metadata',
    },
  },
}
