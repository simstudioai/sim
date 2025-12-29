import Stripe from 'stripe'
import type { SearchSubscriptionsParams, SubscriptionListResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeSearchSubscriptionsTool: ToolConfig<
  SearchSubscriptionsParams,
  SubscriptionListResponse
> = {
  id: 'stripe_search_subscriptions',
  name: 'Stripe Search Subscriptions',
  description: 'Search for subscriptions using query syntax',
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
      description: "Search query (e.g., \"status:'active' AND customer:'cus_xxx'\")",
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
      const searchOptions: Stripe.SubscriptionSearchParams = { query: params.query }
      if (params.limit) searchOptions.limit = params.limit
      const searchResult = await stripe.subscriptions.search(searchOptions)
      return {
        success: true,
        output: {
          subscriptions: searchResult.data || [],
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
        error: `STRIPE_SEARCH_SUBSCRIPTIONS_ERROR: Failed to search subscriptions - ${errorDetails}`,
      }
    }
  },

  outputs: {
    subscriptions: {
      type: 'json',
      description: 'Array of matching subscription objects',
    },
    metadata: {
      type: 'json',
      description: 'Search metadata',
    },
  },
}
