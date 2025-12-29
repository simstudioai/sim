import Stripe from 'stripe'
import type { ChargeListResponse, SearchChargesParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Search Charges Tool
 * Uses official stripe SDK for charge search with query syntax
 */

export const stripeSearchChargesTool: ToolConfig<SearchChargesParams, ChargeListResponse> = {
  id: 'stripe_search_charges',
  name: 'Stripe Search Charges',
  description: 'Search for charges using query syntax',
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
      description: "Search query (e.g., \"status:'succeeded' AND currency:'usd'\")",
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 10, max 100)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Searches charges using Stripe's query syntax
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare search options
      const searchOptions: Stripe.ChargeSearchParams = {
        query: params.query,
      }
      if (params.limit) searchOptions.limit = params.limit

      // Search charges using SDK
      const searchResult = await stripe.charges.search(searchOptions)

      return {
        success: true,
        output: {
          charges: searchResult.data || [],
          metadata: {
            count: searchResult.data.length,
            has_more: searchResult.has_more || false,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `STRIPE_SEARCH_CHARGES_ERROR: Failed to search charges - ${errorDetails}`,
      }
    }
  },

  outputs: {
    charges: {
      type: 'json',
      description: 'Array of matching Charge objects',
    },
    metadata: {
      type: 'json',
      description: 'Search metadata including count and has_more',
    },
  },
}
