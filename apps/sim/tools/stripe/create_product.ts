import Stripe from 'stripe'
import type { CreateProductParams, ProductResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Create Product Tool
 * Uses official stripe SDK for product creation
 */

export const stripeCreateProductTool: ToolConfig<CreateProductParams, ProductResponse> = {
  id: 'stripe_create_product',
  name: 'Stripe Create Product',
  description: 'Create a new product object',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Product name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Product description',
    },
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the product is active',
    },
    images: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of image URLs for the product',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Creates product with metadata and image support
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare product data
      const productData: Stripe.ProductCreateParams = {
        name: params.name,
      }

      if (params.description) productData.description = params.description
      if (params.active !== undefined) productData.active = params.active
      if (params.images) productData.images = params.images
      if (params.metadata) productData.metadata = params.metadata

      // Create product using SDK
      const product = await stripe.products.create(productData)

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
          code: 'STRIPE_CREATE_PRODUCT_ERROR',
          message: error.message || 'Failed to create product',
          details: error,
        },
      }
    }
  },

  outputs: {
    product: {
      type: 'json',
      description: 'The created product object',
    },
    metadata: {
      type: 'json',
      description: 'Product metadata',
    },
  },
}
