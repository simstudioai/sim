import type { ListSubscriptionsParams, SubscriptionListResponse } from '@/tools/stripe/types'
import { LIST_METADATA_OUTPUT_PROPERTIES, SUBSCRIPTION_OUTPUT } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListSubscriptionsTool: ToolConfig<
  ListSubscriptionsParams,
  SubscriptionListResponse
> = {
  id: 'stripe_list_subscriptions',
  name: 'Stripe List Subscriptions',
  description:
    'List one page of subscriptions. Follow starting_after while metadata.has_more is true.',
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
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Next-page cursor: last subscription ID from the previous page. Do not combine with ending_before.',
    },
    ending_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Previous-page cursor: first subscription ID from the current page. Do not combine with starting_after.',
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
      if (params.starting_after && params.ending_before) {
        throw new Error('Provide either starting_after or ending_before, not both')
      }
      const url = new URL('https://api.stripe.com/v1/subscriptions')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.customer) url.searchParams.append('customer', params.customer)
      if (params.status) url.searchParams.append('status', params.status)
      if (params.price) url.searchParams.append('price', params.price)
      if (params.starting_after) url.searchParams.append('starting_after', params.starting_after)
      if (params.ending_before) url.searchParams.append('ending_before', params.ending_before)
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
      type: 'array',
      description: 'Array of subscription objects',
      items: SUBSCRIPTION_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
      properties: LIST_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
