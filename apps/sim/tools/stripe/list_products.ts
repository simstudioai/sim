import Stripe from 'stripe'
import type { ListProductsParams, ProductListResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe List Products Tool
 * Uses official stripe SDK for product listing with pagination and filtering
 */

export const stripeListProductsTool: ToolConfig<ListProductsParams, ProductListResponse> = {
  id: 'stripe_list_products',
  name: 'Stripe List Products',
  description: 'List all products',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 10, max 100)',
    },
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by active status',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Lists products with optional filtering and pagination
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare list options
      const listOptions: Stripe.ProductListParams = {}
      if (params.limit) listOptions.limit = params.limit
      if (params.active !== undefined) listOptions.active = params.active

      // List products using SDK
      const productList = await stripe.products.list(listOptions)

      return {
        success: true,
        output: {
          products: productList.data || [],
          metadata: {
            count: productList.data.length,
            has_more: productList.has_more || false,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'STRIPE_LIST_PRODUCTS_ERROR',
          message: error.message || 'Failed to list products',
          details: error,
        },
      }
    }
  },

  outputs: {
    products: {
      type: 'json',
      description: 'Array of product objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
    },
  },
}
