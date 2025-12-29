import Stripe from 'stripe'
import type { CaptureChargeParams, ChargeResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Capture Charge Tool
 * Uses official stripe SDK to capture authorized charges
 */

export const stripeCaptureChargeTool: ToolConfig<CaptureChargeParams, ChargeResponse> = {
  id: 'stripe_capture_charge',
  name: 'Stripe Capture Charge',
  description: 'Capture an uncaptured charge',
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
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount to capture in cents (defaults to full amount)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Captures authorized charge with optional partial amount
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare capture options
      const captureOptions: Stripe.ChargeCaptureParams = {}
      if (params.amount) captureOptions.amount = Number(params.amount)

      // Capture charge using SDK
      const charge = await stripe.charges.capture(params.id, captureOptions)

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
        error: `STRIPE_CAPTURE_CHARGE_ERROR: Failed to capture charge - ${errorDetails}`,
      }
    }
  },

  outputs: {
    charge: {
      type: 'json',
      description: 'The captured Charge object',
    },
    metadata: {
      type: 'json',
      description: 'Charge metadata including ID, status, amount, currency, and paid status',
    },
  },
}
