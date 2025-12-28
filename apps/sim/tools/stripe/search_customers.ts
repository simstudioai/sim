import Stripe from 'stripe'
import type { CustomerListResponse, SearchCustomersParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Search Customers Tool
 * Uses official stripe SDK for customer search with query syntax
 */

export const stripeSearchCustomersTool: ToolConfig<SearchCustomersParams, CustomerListResponse> = {
  id: 'stripe_search_customers',
  name: 'Stripe Search Customers',
  description: 'Search for customers using query syntax',
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
      description: 'Search query (e.g., "email:\'customer@example.com\'")',
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
   * Searches customers using Stripe's query syntax
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare search options
      const searchOptions: Stripe.CustomerSearchParams = {
        query: params.query,
      }
      if (params.limit) searchOptions.limit = params.limit

      // Search customers using SDK
      const searchResult = await stripe.customers.search(searchOptions)

      return {
        success: true,
        output: {
          customers: searchResult.data || [],
          metadata: {
            count: searchResult.data.length,
            has_more: searchResult.has_more || false,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_SEARCH_CUSTOMERS_ERROR',
          message: error.message || 'Failed to search customers',
          details: error,
        },
      }
    }
  },

  outputs: {
    customers: {
      type: 'json',
      description: 'Array of matching customer objects',
    },
    metadata: {
      type: 'json',
      description: 'Search metadata',
    },
  },
}
