import Stripe from 'stripe'
import type { ProductResponse, UpdateProductParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Update Product Tool
 * Uses official stripe SDK for product updates
 */

export const stripeUpdateProductTool: ToolConfig<UpdateProductParams, ProductResponse> = {
  id: 'stripe_update_product',
  name: 'Stripe Update Product',
  description: 'Update an existing product',
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
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated product name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated product description',
    },
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated active status',
    },
    images: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated array of image URLs',
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
   * Updates product with optional fields
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare update data
      const updateData: Stripe.ProductUpdateParams = {}
      if (params.name) updateData.name = params.name
      if (params.description) updateData.description = params.description
      if (params.active !== undefined) updateData.active = params.active
      if (params.images) updateData.images = params.images
      if (params.metadata) updateData.metadata = params.metadata

      // Update product using SDK
      const product = await stripe.products.update(params.id, updateData)

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
          code: 'STRIPE_UPDATE_PRODUCT_ERROR',
          message: error.message || 'Failed to update product',
          details: error,
        },
      }
    }
  },

  outputs: {
    product: {
      type: 'json',
      description: 'The updated product object',
    },
    metadata: {
      type: 'json',
      description: 'Product metadata',
    },
  },
}
