import Stripe from 'stripe'
import type { EventResponse, RetrieveEventParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Retrieve Event Tool
 * Uses official stripe SDK for event retrieval
 */

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

  /**
   * SDK-based execution using stripe SDK
   * Retrieves event by ID with full event data
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Retrieve event using SDK
      const event = await stripe.events.retrieve(params.id)

      return {
        success: true,
        output: {
          event,
          metadata: {
            id: event.id,
            type: event.type,
            created: event.created,
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
        error: `STRIPE_RETRIEVE_EVENT_ERROR: Failed to retrieve event - ${errorDetails}`,
      }
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
