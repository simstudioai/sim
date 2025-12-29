import Stripe from 'stripe'
import type { DeleteProductParams, ProductDeleteResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Delete Product Tool
 * Uses official stripe SDK to permanently delete products
 */

export const stripeDeleteProductTool: ToolConfig<DeleteProductParams, ProductDeleteResponse> = {
  id: 'stripe_delete_product',
  name: 'Stripe Delete Product',
  description: 'Permanently delete a product',
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
      visibility: 'user-only',
      description: 'Product ID (e.g., prod_1234567890) - requires human confirmation for deletion',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Permanently deletes product record
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Delete product using SDK
      const deletionConfirmation = await stripe.products.del(params.id)

      return {
        success: true,
        output: {
          deleted: deletionConfirmation.deleted,
          id: deletionConfirmation.id,
          metadata: {
            id: deletionConfirmation.id,
            deleted: deletionConfirmation.deleted,
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
        error: `STRIPE_DELETE_PRODUCT_ERROR: Failed to delete product - ${errorDetails}`,
      }
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the product was deleted',
    },
    id: {
      type: 'string',
      description: 'The ID of the deleted product',
    },
    metadata: {
      type: 'json',
      description: 'Deletion metadata',
    },
  },
}
