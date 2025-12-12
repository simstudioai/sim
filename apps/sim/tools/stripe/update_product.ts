import type { ProductResponse, UpdateProductParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

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

  request: {
    url: (params) => `https://api.stripe.com/v1/products/${params.id}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      if (params.name) formData.append('name', params.name)
      if (params.description) formData.append('description', params.description)
      if (params.active !== undefined) formData.append('active', String(params.active))

      if (params.images) {
        params.images.forEach((image: string, index: number) => {
          formData.append(`images[${index}]`, image)
        })
      }

      if (params.metadata) {
        Object.entries(params.metadata).forEach(([key, value]) => {
          formData.append(`metadata[${key}]`, String(value))
        })
      }

      return { body: formData.toString() }
    },
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
      description: 'The updated product object',
    },
    metadata: {
      type: 'json',
      description: 'Product metadata',
    },
  },
}
