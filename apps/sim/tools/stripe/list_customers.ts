import { STRIPE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { CustomerListResponse, ListCustomersParams } from '@/tools/stripe/types'
import { CUSTOMER_OUTPUT, LIST_METADATA_OUTPUT_PROPERTIES } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListCustomersTool: ToolConfig<ListCustomersParams, CustomerListResponse> = {
  id: 'stripe_list_customers',
  name: 'Stripe List Customers',
  description: 'List all customers',
  version: '1.0.0',
  oauth: STRIPE_CREDENTIAL_OAUTH,

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
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Next-page cursor: last customer ID from the previous page. Do not combine with ending_before.',
    },
    ending_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Previous-page cursor: first customer ID from the current page. Do not combine with starting_after.',
    },
  },

  request: {
    url: (params) => {
      if (params.starting_after && params.ending_before) {
        throw new Error('Provide either starting_after or ending_before, not both')
      }
      const url = new URL('https://api.stripe.com/v1/customers')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.starting_after) url.searchParams.append('starting_after', params.starting_after)
      if (params.ending_before) url.searchParams.append('ending_before', params.ending_before)
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
      type: 'array',
      description: 'Array of customer objects',
      items: CUSTOMER_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
