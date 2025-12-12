import type { EventResponse, RetrieveEventParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeRetrieveEventTool: ToolConfig<RetrieveEventParams, EventResponse> = {
  id: 'stripe_retrieve_event',
  name: 'Stripe Retrieve Event',
  description: 'Retrieve an existing Event by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event ID (e.g., evt_1234567890)',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/events/${params.id}`,
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
        event: data,
        metadata: {
          id: data.id,
          type: data.type,
          created: data.created,
        },
      },
    }
  },

  outputs: {
    event: {
      type: 'json',
      description: 'The retrieved Event object',
    },
    metadata: {
      type: 'json',
      description: 'Event metadata including ID, type, and created timestamp',
    },
  },
}
