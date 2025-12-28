import Stripe from 'stripe'
import type { ChargeResponse, UpdateChargeParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Update Charge Tool
 * Uses official stripe SDK for charge updates
 */

export const stripeUpdateChargeTool: ToolConfig<UpdateChargeParams, ChargeResponse> = {
  id: 'stripe_update_charge',
  name: 'Stripe Update Charge',
  description: 'Update an existing charge',
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
   * Updates charge with optional fields
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare update data
      const updateData: Stripe.ChargeUpdateParams = {}
      if (params.description) updateData.description = params.description
      if (params.metadata) updateData.metadata = params.metadata

      // Update charge using SDK
      const charge = await stripe.charges.update(params.id, updateData)

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
      return {
        success: false,
        error: {
          code: 'STRIPE_UPDATE_CHARGE_ERROR',
          message: error.message || 'Failed to update charge',
          details: error,
        },
      }
    }
  },

  outputs: {
    charge: {
      type: 'json',
      description: 'The updated Charge object',
    },
    metadata: {
      type: 'json',
      description: 'Charge metadata including ID, status, amount, currency, and paid status',
    },
  },
}
