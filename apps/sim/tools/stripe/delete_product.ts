import type { DeleteProductParams, ProductDeleteResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-or-llm',
      description: 'Product ID (e.g., prod_1234567890)',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/products/${params.id}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        deleted: data.deleted,
        id: data.id,
        metadata: {
          id: data.id,
          deleted: data.deleted,
        },
      },
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
