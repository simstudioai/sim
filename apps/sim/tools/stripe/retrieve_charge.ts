import Stripe from 'stripe'
import type { ChargeResponse, RetrieveChargeParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Retrieve Charge Tool
 * Uses official stripe SDK for charge retrieval
 */

export const stripeRetrieveChargeTool: ToolConfig<RetrieveChargeParams, ChargeResponse> = {
  id: 'stripe_retrieve_charge',
  name: 'Stripe Retrieve Charge',
  description: 'Retrieve an existing charge by ID',
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
      description: 'Charge ID (e.g., ch_1234567890)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Retrieves charge by ID with full charge data
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Retrieve charge using SDK
      const charge = await stripe.charges.retrieve(params.id)

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
        error: `STRIPE_RETRIEVE_CHARGE_ERROR: Failed to retrieve charge - ${errorDetails}`,
      }
    }
  },

  outputs: {
    charge: {
      type: 'json',
      description: 'The retrieved Charge object',
    },
    metadata: {
      type: 'json',
      description: 'Charge metadata including ID, status, amount, currency, and paid status',
    },
  },
}
