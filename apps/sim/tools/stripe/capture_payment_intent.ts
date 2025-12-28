import Stripe from 'stripe'
import type { CapturePaymentIntentParams, PaymentIntentResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Capture Payment Intent Tool
 * Uses official stripe SDK to capture authorized payment intents
 */

export const stripeCapturePaymentIntentTool: ToolConfig<
  CapturePaymentIntentParams,
  PaymentIntentResponse
> = {
  id: 'stripe_capture_payment_intent',
  name: 'Stripe Capture Payment Intent',
  description: 'Capture an authorized Payment Intent',
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
    amount_to_capture: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount to capture in cents (defaults to full amount)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Captures authorized payment intent with optional partial amount
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare capture options
      const captureOptions: Stripe.PaymentIntentCaptureParams = {}
      if (params.amount_to_capture) {
        captureOptions.amount_to_capture = Number(params.amount_to_capture)
      }

      // Capture payment intent using SDK
      const paymentIntent = await stripe.paymentIntents.capture(params.id, captureOptions)

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
          code: 'STRIPE_CAPTURE_PAYMENT_INTENT_ERROR',
          message: error.message || 'Failed to capture payment intent',
          details: error,
        },
      }
    }
  },

  outputs: {
    payment_intent: {
      type: 'json',
      description: 'The captured Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
    },
  },
}
