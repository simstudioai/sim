import Stripe from 'stripe'
import type { CancelPaymentIntentParams, PaymentIntentResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Cancel Payment Intent Tool
 * Uses official stripe SDK to cancel payment intents
 */

export const stripeCancelPaymentIntentTool: ToolConfig<
  CancelPaymentIntentParams,
  PaymentIntentResponse
> = {
  id: 'stripe_cancel_payment_intent',
  name: 'Stripe Cancel Payment Intent',
  description: 'Cancel a Payment Intent',
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
    cancellation_reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Reason for cancellation (duplicate, fraudulent, requested_by_customer, abandoned)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Cancels payment intent with optional cancellation reason
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare cancel options
      const cancelOptions: Stripe.PaymentIntentCancelParams = {}
      if (params.cancellation_reason) {
        cancelOptions.cancellation_reason = params.cancellation_reason as Stripe.PaymentIntentCancelParams.CancellationReason
      }

      // Cancel payment intent using SDK
      const paymentIntent = await stripe.paymentIntents.cancel(params.id, cancelOptions)

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
          code: 'STRIPE_CANCEL_PAYMENT_INTENT_ERROR',
          message: error.message || 'Failed to cancel payment intent',
          details: error,
        },
      }
    }
  },

  outputs: {
    payment_intent: {
      type: 'json',
      description: 'The canceled Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
    },
  },
}
