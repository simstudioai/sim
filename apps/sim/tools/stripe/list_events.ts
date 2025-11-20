import type { EventListResponse, ListEventsParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListEventsTool: ToolConfig<ListEventsParams, EventListResponse> = {
  id: 'stripe_list_events',
  name: 'Stripe List Events',
  description: 'List all Events',
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
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by event type (e.g., payment_intent.created)',
    },
    created: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by creation date (e.g., {"gt": 1633024800})',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/events')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.type) url.searchParams.append('type', params.type)
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
        events: data.data || [],
        metadata: {
          count: (data.data || []).length,
          has_more: data.has_more || false,
        },
      },
    }
  },

  outputs: {
    events: {
      type: 'json',
      description: 'Array of Event objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata including count and has_more',
    },
  },
}
