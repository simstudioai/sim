import Stripe from 'stripe'
import type { ChargeResponse, CreateChargeParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Create Charge Tool
 * Uses official stripe SDK for charge creation
 */
export const stripeCreateChargeTool: ToolConfig<CreateChargeParams, ChargeResponse> = {
  id: 'stripe_create_charge',
  name: 'Stripe Create Charge',
  description: 'Create a new charge to process a payment',
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
      description: 'Customer ID to associate with this charge',
    },
    source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment source ID (e.g., card token or saved card ID)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the charge',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs for storing additional information',
    },
    capture: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to immediately capture the charge (defaults to true)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Creates charge with optional capture delay
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare charge data
      const chargeData: Stripe.ChargeCreateParams = {
        amount: Number(params.amount),
        currency: params.currency,
      }

      if (params.customer) chargeData.customer = params.customer
      if (params.source) chargeData.source = params.source
      if (params.description) chargeData.description = params.description
      if (params.capture !== undefined) chargeData.capture = params.capture
      if (params.metadata) chargeData.metadata = params.metadata

      // Create charge using SDK
      const charge = await stripe.charges.create(chargeData)

      return {
        success: true,
        output: {
          charge,
          metadata: {
            id: charge.id,
            status: charge.status,
            amount: charge.amount,
            currency: charge.currency,
            paid: charge.paid,
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
        error: `STRIPE_CHARGE_ERROR: Failed to create charge - ${errorDetails}`,
      }
    }
  },

  outputs: {
    charge: {
      type: 'json',
      description: 'The created Charge object',
    },
    metadata: {
      type: 'json',
      description: 'Charge metadata including ID, status, amount, currency, and paid status',
    },
  },
}
