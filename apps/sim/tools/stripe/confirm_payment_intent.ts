import Stripe from 'stripe'
import type { ConfirmPaymentIntentParams, PaymentIntentResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Confirm Payment Intent Tool
 * Uses official stripe SDK to confirm payment intents
 */

export const stripeConfirmPaymentIntentTool: ToolConfig<
  ConfirmPaymentIntentParams,
  PaymentIntentResponse
> = {
  id: 'stripe_confirm_payment_intent',
  name: 'Stripe Confirm Payment Intent',
  description: 'Confirm a Payment Intent to complete the payment',
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
    payment_method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment method ID to confirm with',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Confirms payment intent to complete the payment
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare confirm options
      const confirmOptions: Stripe.PaymentIntentConfirmParams = {}
      if (params.payment_method) confirmOptions.payment_method = params.payment_method

      // Confirm payment intent using SDK
      const paymentIntent = await stripe.paymentIntents.confirm(params.id, confirmOptions)

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
          code: 'STRIPE_CONFIRM_PAYMENT_INTENT_ERROR',
          message: error.message || 'Failed to confirm payment intent',
          details: error,
        },
      }
    }
  },

  outputs: {
    payment_intent: {
      type: 'json',
      description: 'The confirmed Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
    },
  },
}
