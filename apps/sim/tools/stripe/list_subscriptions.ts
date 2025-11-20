import type { ListSubscriptionsParams, SubscriptionListResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListSubscriptionsTool: ToolConfig<
  ListSubscriptionsParams,
  SubscriptionListResponse
> = {
  id: 'stripe_list_subscriptions',
  name: 'Stripe List Subscriptions',
  description: 'List all subscriptions',
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
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by customer ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by status (active, past_due, unpaid, canceled, incomplete, incomplete_expired, trialing, all)',
    },
    price: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by price ID',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/subscriptions')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.customer) url.searchParams.append('customer', params.customer)
      if (params.status) url.searchParams.append('status', params.status)
      if (params.price) url.searchParams.append('price', params.price)
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
        subscriptions: data.data || [],
        metadata: {
          count: (data.data || []).length,
          has_more: data.has_more || false,
        },
      },
    }
  },

  outputs: {
    subscriptions: {
      type: 'json',
      description: 'Array of subscription objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
    },
  },
}
