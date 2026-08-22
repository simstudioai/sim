import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { CreateProductParams, ProductResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

const DELIVERY = defineStripeKeyedSite(
  'stripe_create_product',
  'a duplicate product would appear in the catalog and buyers would see the same item listed twice'
)

export const stripeCreateProductTool: ToolConfig<
  CreateProductParams & StripeDeliveryContextParams,
  ProductResponse
> = {
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
    /**
     * The `Idempotency-Key` must be the *same* on every delivery of one
     * instruction rather than fresh per attempt — it is what lets Stripe
     * recognize a resend and replay its first answer instead of acting again. A
     * value minted at request-build time is the inverse of the header's purpose:
     * it is stable only inside the transport loop, and every retry layer above
     * that re-enters tool preparation and looks to Stripe like a new write.
     */
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...stripeIdempotencyHeader(DELIVERY, params),
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
      properties: {
        id: { type: 'string', description: 'Stripe unique identifier' },
        name: { type: 'string', description: 'Display name' },
        active: { type: 'boolean', description: 'Whether the resource is currently active' },
      },
    },
  },
}
