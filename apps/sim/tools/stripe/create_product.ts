import type { CreateProductParams, ProductResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

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

  request: {
    url: () => 'https://api.stripe.com/v1/products',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()

      formData.append('name', params.name)
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
      description: 'The created product object',
    },
    metadata: {
      type: 'json',
      description: 'Product metadata',
    },
  },
}
