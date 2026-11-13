import { STRIPE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ChargeListResponse, ListChargesParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListChargesTool: ToolConfig<ListChargesParams, ChargeListResponse> = {
  id: 'stripe_list_charges',
  name: 'Stripe List Charges',
  description: 'List all charges',
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
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by customer ID',
    },
    created: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by creation date (e.g., {"gt": 1633024800})',
    },
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Next-page cursor: last charge ID from the previous page. Do not combine with ending_before.',
    },
    ending_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Previous-page cursor: first charge ID from the current page. Do not combine with starting_after.',
    },
  },

  request: {
    url: (params) => {
      if (params.starting_after && params.ending_before) {
        throw new Error('Provide either starting_after or ending_before, not both')
      }
      const url = new URL('https://api.stripe.com/v1/charges')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.starting_after) url.searchParams.append('starting_after', params.starting_after)
      if (params.ending_before) url.searchParams.append('ending_before', params.ending_before)
      if (params.customer) url.searchParams.append('customer', params.customer)
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
      description: 'Array of Charge objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata including count and has_more',
      properties: {
        count: { type: 'number', description: 'Number of items returned' },
        has_more: { type: 'boolean', description: 'Whether more items exist beyond this page' },
      },
    },
  },
}
