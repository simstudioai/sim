import type { ProductResponse, RetrieveProductParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

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

  request: {
    url: (params) => `https://api.stripe.com/v1/products/${params.id}`,
    method: 'GET',
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
        product: data,
        metadata: {
          id: data.id,
          name: data.name,
          active: data.active,
        },
      },
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
