import Stripe from 'stripe'
import type { ListPricesParams, PriceListResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe List Prices Tool
 * Uses official stripe SDK for price listing with pagination and filtering
 */

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

  /**
   * SDK-based execution using stripe SDK
   * Lists prices with optional filtering and pagination
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare list options
      const listOptions: Stripe.PriceListParams = {}
      if (params.limit) listOptions.limit = params.limit
      if (params.product) listOptions.product = params.product
      if (params.active !== undefined) listOptions.active = params.active

      // List prices using SDK
      const priceList = await stripe.prices.list(listOptions)

      return {
        success: true,
        output: {
          prices: priceList.data || [],
          metadata: {
            count: priceList.data.length,
            has_more: priceList.has_more || false,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_LIST_PRICES_ERROR',
          message: error.message || 'Failed to list prices',
          details: error,
        },
      }
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
