import Stripe from 'stripe'
import type { ProductResponse, RetrieveProductParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Retrieve Product Tool
 * Uses official stripe SDK for product retrieval
 */

export const stripeRetrieveProductTool: ToolConfig<RetrieveProductParams, ProductResponse> = {
  id: 'stripe_retrieve_product',
  name: 'Stripe Retrieve Product',
  description: 'Retrieve an existing product by ID',
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
      description: 'Product ID (e.g., prod_1234567890)',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Retrieves product by ID with full product data
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Retrieve product using SDK
      const product = await stripe.products.retrieve(params.id)

      return {
        success: true,
        output: {
          product,
          metadata: {
            id: product.id,
            name: product.name,
            active: product.active,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_RETRIEVE_PRODUCT_ERROR',
          message: error.message || 'Failed to retrieve product',
          details: error,
        },
      }
    }
  },

  outputs: {
    product: {
      type: 'json',
      description: 'The retrieved product object',
    },
    metadata: {
      type: 'json',
      description: 'Product metadata',
    },
  },
}
