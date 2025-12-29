import Stripe from 'stripe'
import type { ListPaymentIntentsParams, PaymentIntentListResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe List Payment Intents Tool
 * Uses official stripe SDK for payment intent listing with pagination and filtering
 */

export const stripeListPaymentIntentsTool: ToolConfig<
  ListPaymentIntentsParams,
  PaymentIntentListResponse
> = {
  id: 'stripe_list_payment_intents',
  name: 'Stripe List Payment Intents',
  description: 'List all Payment Intents',
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
    created: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by creation date (e.g., {"gt": 1633024800})',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Lists payment intents with optional filtering and pagination
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare list options
      const listOptions: Stripe.PaymentIntentListParams = {}
      if (params.limit) listOptions.limit = params.limit
      if (params.customer) listOptions.customer = params.customer
      if (params.created) listOptions.created = params.created

      // List payment intents using SDK
      const paymentIntentList = await stripe.paymentIntents.list(listOptions)

      return {
        success: true,
        output: {
          payment_intents: paymentIntentList.data || [],
          metadata: {
            count: paymentIntentList.data.length,
            has_more: paymentIntentList.has_more || false,
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
        error: `STRIPE_LIST_PAYMENT_INTENTS_ERROR: Failed to list payment intents - ${errorDetails}`,
      }
    }
  },

  outputs: {
    payment_intents: {
      type: 'json',
      description: 'Array of Payment Intent objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata including count and has_more',
    },
  },
}
