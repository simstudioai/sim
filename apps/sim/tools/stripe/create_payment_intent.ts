import Stripe from 'stripe'
import type { CreatePaymentIntentParams, PaymentIntentResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { validateFinancialAmount } from '@/tools/financial-validation'
import { createLogger } from '@sim/logger'

const logger = createLogger('StripeCreatePaymentIntent')

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
      // Validate amount (Stripe uses cents, so min is 50 cents = $0.50 for most currencies)
      const amountValidation = validateFinancialAmount(params.amount, {
        fieldName: 'amount',
        allowZero: false,
        allowNegative: false,
        min: 50, // Minimum 50 cents for Stripe
        max: 99999999, // Stripe's maximum: $999,999.99
        currency: params.currency.toUpperCase(),
      })

      if (!amountValidation.valid) {
        logger.error('Payment intent amount validation failed', {
          amount: params.amount,
          error: amountValidation.error,
        })
        return {
          success: false,
          output: {},
          error: `STRIPE_VALIDATION_ERROR: ${amountValidation.error}`,
        }
      }

      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare payment intent data with validated amount
      const paymentIntentData: Stripe.PaymentIntentCreateParams = {
        amount: Math.round(amountValidation.sanitized || params.amount),
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
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      logger.error('Failed to create payment intent', { error: errorDetails })
      return {
        success: false,
        output: {},
        error: `STRIPE_PAYMENT_INTENT_ERROR: Failed to create payment intent - ${errorDetails}`,
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
