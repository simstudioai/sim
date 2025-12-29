import Stripe from 'stripe'
import type { PriceResponse, UpdatePriceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Update Price Tool
 * Uses official stripe SDK for price updates
 */

export const stripeUpdatePriceTool: ToolConfig<UpdatePriceParams, PriceResponse> = {
  id: 'stripe_update_price',
  name: 'Stripe Update Price',
  description: 'Update an existing price',
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
      description: 'Price ID (e.g., price_1234567890)',
    },
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the price is active',
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
   * Updates price with optional fields (note: amount cannot be changed)
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare update data
      const updateData: Stripe.PriceUpdateParams = {}
      if (params.active !== undefined) updateData.active = params.active
      if (params.metadata) updateData.metadata = params.metadata

      // Update price using SDK
      const price = await stripe.prices.update(params.id, updateData)

      return {
        success: true,
        output: {
          price,
          metadata: {
            id: price.id,
            product: price.product as string,
            unit_amount: price.unit_amount,
            currency: price.currency,
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
        error: `STRIPE_UPDATE_PRICE_ERROR: Failed to update price - ${errorDetails}`,
      }
    }
  },

  outputs: {
    price: {
      type: 'json',
      description: 'The updated price object',
    },
    metadata: {
      type: 'json',
      description: 'Price metadata',
    },
  },
}
