import Stripe from 'stripe'
import type { PaymentIntentResponse, UpdatePaymentIntentParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Update Payment Intent Tool
 * Uses official stripe SDK for payment intent updates
 */

export const stripeUpdatePaymentIntentTool: ToolConfig<
  UpdatePaymentIntentParams,
  PaymentIntentResponse
> = {
  id: 'stripe_update_payment_intent',
  name: 'Stripe Update Payment Intent',
  description: 'Update an existing Payment Intent',
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
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated amount in cents',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Three-letter ISO currency code',
    },
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer ID',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated metadata',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Updates payment intent with optional fields
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare update data
      const updateData: Stripe.PaymentIntentUpdateParams = {}
      if (params.amount) updateData.amount = Number(params.amount)
      if (params.currency) updateData.currency = params.currency
      if (params.customer) updateData.customer = params.customer
      if (params.description) updateData.description = params.description
      if (params.metadata) updateData.metadata = params.metadata

      // Update payment intent using SDK
      const paymentIntent = await stripe.paymentIntents.update(params.id, updateData)

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
          code: 'STRIPE_UPDATE_PAYMENT_INTENT_ERROR',
          message: error.message || 'Failed to update payment intent',
          details: error,
        },
      }
    }
  },

  outputs: {
    payment_intent: {
      type: 'json',
      description: 'The updated Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
    },
  },
}
