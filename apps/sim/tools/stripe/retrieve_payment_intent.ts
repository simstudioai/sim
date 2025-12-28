import Stripe from 'stripe'
import type { PaymentIntentResponse, RetrievePaymentIntentParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Retrieve Payment Intent Tool
 * Uses official stripe SDK for payment intent retrieval
 */

export const stripeRetrievePaymentIntentTool: ToolConfig<
  RetrievePaymentIntentParams,
  PaymentIntentResponse
> = {
  id: 'stripe_retrieve_payment_intent',
  name: 'Stripe Retrieve Payment Intent',
  description: 'Retrieve an existing Payment Intent by ID',
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
      description: 'Payment Intent ID (e.g., pi_1234567890)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Retrieves payment intent by ID with full intent data
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Retrieve payment intent using SDK
      const paymentIntent = await stripe.paymentIntents.retrieve(params.id)

      return {
        success: true,
        output: {
          payment_intent: paymentIntent,
          metadata: {
            id: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_RETRIEVE_PAYMENT_INTENT_ERROR',
          message: error.message || 'Failed to retrieve payment intent',
          details: error,
        },
      }
    }
  },

  outputs: {
    payment_intent: {
      type: 'json',
      description: 'The retrieved Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
    },
  },
}
