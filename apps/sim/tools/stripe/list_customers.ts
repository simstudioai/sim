import type { CustomerListResponse, ListCustomersParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListCustomersTool: ToolConfig<ListCustomersParams, CustomerListResponse> = {
  id: 'stripe_list_customers',
  name: 'Stripe List Customers',
  description: 'List all customers',
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
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by email address',
    },
    created: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by creation date',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/customers')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.email) url.searchParams.append('email', params.email)
      if (params.created) {
        Object.entries(params.created).forEach(([key, value]) => {
          url.searchParams.append(`created[${key}]`, String(value))
        })
      }
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
      description: 'Array of customer objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
    },
  },
}
