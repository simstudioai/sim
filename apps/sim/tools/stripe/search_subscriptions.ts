import type { SearchSubscriptionsParams, SubscriptionSearchResponse } from '@/tools/stripe/types'
import { LIST_METADATA_OUTPUT_PROPERTIES, SUBSCRIPTION_OUTPUT } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeSearchSubscriptionsTool: ToolConfig<
  SearchSubscriptionsParams,
  SubscriptionSearchResponse
> = {
  id: 'stripe_search_subscriptions',
  name: 'Stripe Search Subscriptions',
  description:
    'Search one page of subscriptions using query syntax. Pass metadata.next_page as page to continue.',
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
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination token from metadata.next_page. Omit for the first page and keep the same query.',
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
      const url = new URL('https://api.stripe.com/v1/subscriptions/search')
      url.searchParams.append('query', params.query)
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.page) url.searchParams.append('page', params.page)
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
          next_page: data.next_page ?? null,
        },
      },
    }
  },

  outputs: {
    subscriptions: {
      type: 'array',
      description: 'Array of matching subscription objects',
      items: SUBSCRIPTION_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'Search metadata',
      properties: {
        ...LIST_METADATA_OUTPUT_PROPERTIES,
        next_page: {
          type: 'string',
          nullable: true,
          description:
            'Token for the next page of search results, or null when there are no more results',
        },
      },
    },
  },
}
