import Stripe from 'stripe'
import type { CreatePaymentIntentParams, PaymentIntentResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Create Payment Intent Tool
 * Uses official stripe SDK for payment intent creation
 */
export const stripeCreatePaymentIntentTool: ToolConfig<
  CreatePaymentIntentParams,
  PaymentIntentResponse
> = {
  id: 'stripe_create_payment_intent',
  name: 'Stripe Create Payment Intent',
  description: 'Create a new Payment Intent to process a payment',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amount in cents (e.g., 2000 for $20.00)',
    },
    currency: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Three-letter ISO currency code (e.g., usd, eur)',
    },
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer ID to associate with this payment',
    },
    payment_method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment method ID',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the payment',
    },
    receipt_email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address to send receipt to',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs for storing additional information',
    },
    automatic_payment_methods: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable automatic payment methods (e.g., {"enabled": true})',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Creates payment intent with full payment method support
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare payment intent data
      const paymentIntentData: Stripe.PaymentIntentCreateParams = {
        amount: Number(params.amount),
        currency: params.currency,
      }

      if (params.customer) paymentIntentData.customer = params.customer
      if (params.payment_method) paymentIntentData.payment_method = params.payment_method
      if (params.description) paymentIntentData.description = params.description
      if (params.receipt_email) paymentIntentData.receipt_email = params.receipt_email
      if (params.metadata) paymentIntentData.metadata = params.metadata
      if (params.automatic_payment_methods) {
        paymentIntentData.automatic_payment_methods = params.automatic_payment_methods
      }

      // Create payment intent using SDK
      const paymentIntent = await stripe.paymentIntents.create(paymentIntentData)

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
          code: 'STRIPE_PAYMENT_INTENT_ERROR',
          message: error.message || 'Failed to create payment intent',
          details: error,
        },
      }
    }
  },

  outputs: {
    payment_intent: {
      type: 'json',
      description: 'The created Payment Intent object',
    },
    metadata: {
      type: 'json',
      description: 'Payment Intent metadata including ID, status, amount, and currency',
    },
  },
}
