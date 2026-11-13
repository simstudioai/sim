import { STRIPE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { PaymentIntentListResponse, SearchPaymentIntentsParams } from '@/tools/stripe/types'
import { PAYMENT_INTENT_OUTPUT, SEARCH_METADATA_OUTPUT_PROPERTIES } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeSearchPaymentIntentsTool: ToolConfig<
  SearchPaymentIntentsParams,
  PaymentIntentListResponse
> = {
  id: 'stripe_search_payment_intents',
  name: 'Stripe Search Payment Intents',
  description: 'Search for Payment Intents using query syntax',
  version: '1.0.0',
  oauth: STRIPE_CREDENTIAL_OAUTH,

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
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination token from metadata.next_page of the previous search; omit for the first page',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/payment_intents/search')
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
        payment_intents: data.data || [],
        metadata: {
          count: (data.data || []).length,
          has_more: data.has_more || false,
          next_page: data.next_page ?? null,
        },
      },
    }
  },

  outputs: {
    payment_intents: {
      type: 'array',
      description: 'Array of matching Payment Intent objects',
      items: PAYMENT_INTENT_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'Search metadata including count and has_more',
      properties: SEARCH_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
