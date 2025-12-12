import type { ChargeListResponse, SearchChargesParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

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

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/charges/search')
      url.searchParams.append('query', params.query)
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
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
        charges: data.data || [],
        metadata: {
          count: (data.data || []).length,
          has_more: data.has_more || false,
        },
      },
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
