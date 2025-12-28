import Stripe from 'stripe'
import type { PriceResponse, RetrievePriceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Retrieve Price Tool
 * Uses official stripe SDK for price retrieval
 */

export const stripeRetrievePriceTool: ToolConfig<RetrievePriceParams, PriceResponse> = {
  id: 'stripe_retrieve_price',
  name: 'Stripe Retrieve Price',
  description: 'Retrieve an existing price by ID',
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
  },

  /**
   * SDK-based execution using stripe SDK
   * Retrieves price by ID with full pricing data
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Retrieve price using SDK
      const price = await stripe.prices.retrieve(params.id)

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
      return {
        success: false,
        error: {
          code: 'STRIPE_RETRIEVE_PRICE_ERROR',
          message: error.message || 'Failed to retrieve price',
          details: error,
        },
      }
    }
  },

  outputs: {
    price: {
      type: 'json',
      description: 'The retrieved price object',
    },
    metadata: {
      type: 'json',
      description: 'Price metadata',
    },
  },
}
