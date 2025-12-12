import type { CustomerListResponse, SearchCustomersParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

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

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/customers/search')
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
        customers: data.data || [],
        metadata: {
          count: (data.data || []).length,
          has_more: data.has_more || false,
        },
      },
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
