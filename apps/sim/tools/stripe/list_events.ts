import Stripe from 'stripe'
import type { EventListResponse, ListEventsParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe List Events Tool
 * Uses official stripe SDK for event listing with filtering
 */

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

  /**
   * SDK-based execution using stripe SDK
   * Lists events with optional filtering by type and date
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare list options
      const listOptions: Stripe.EventListParams = {}
      if (params.limit) listOptions.limit = params.limit
      if (params.type) listOptions.type = params.type
      if (params.created) listOptions.created = params.created

      // List events using SDK
      const eventList = await stripe.events.list(listOptions)

      return {
        success: true,
        output: {
          events: eventList.data || [],
          metadata: {
            count: eventList.data.length,
            has_more: eventList.has_more || false,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `STRIPE_LIST_EVENTS_ERROR: Failed to list events - ${errorDetails}`,
      }
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
