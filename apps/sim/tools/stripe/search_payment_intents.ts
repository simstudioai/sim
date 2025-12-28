import Stripe from 'stripe'
import type { PaymentIntentListResponse, SearchPaymentIntentsParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeSearchPaymentIntentsTool: ToolConfig<
  SearchPaymentIntentsParams,
  PaymentIntentListResponse
> = {
  id: 'stripe_search_payment_intents',
  name: 'Stripe Search Payment Intents',
  description: 'Search for Payment Intents using query syntax',
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

  directExecution: async (params) => {
    try {
      const stripe = new Stripe(params.apiKey, { apiVersion: '2024-12-18.acacia' })
      const searchOptions: Stripe.PaymentIntentSearchParams = { query: params.query }
      if (params.limit) searchOptions.limit = params.limit
      const searchResult = await stripe.paymentIntents.search(searchOptions)
      return {
        success: true,
        output: {
          payment_intents: searchResult.data || [],
          metadata: { count: searchResult.data.length, has_more: searchResult.has_more || false },
        },
      }
    } catch (error: any) {
      return { success: false, error: { code: 'STRIPE_SEARCH_PAYMENT_INTENTS_ERROR', message: error.message || 'Failed to search payment intents', details: error } }
    }
  },

  outputs: {
    payment_intents: {
      type: 'json',
      description: 'Array of matching Payment Intent objects',
    },
    metadata: {
      type: 'json',
      description: 'Search metadata including count and has_more',
    },
  },
}
