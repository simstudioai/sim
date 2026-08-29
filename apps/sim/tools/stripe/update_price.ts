import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { PriceResponse, UpdatePriceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const DELIVERY = defineStripeKeyedSite(
  'stripe_update_price',
  'the edit would be re-applied over any change made to the price in between, so a price the user deactivated could go back on sale'
)

export const stripeUpdatePriceTool: ToolConfig<
  UpdatePriceParams & StripeDeliveryContextParams,
  PriceResponse
> = {
  id: 'stripe_update_price',
  name: 'Stripe Update Price',
  description: 'Update an existing price',
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
      description: 'Price ID (e.g., price_1234567890)',
    },
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the price is active',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated metadata',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/prices/${safeUrlPathSegment(params.id, 'id')}`,
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

      if (params.active !== undefined) formData.append('active', String(params.active))

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
        price: data,
        metadata: {
          id: data.id,
          product: data.product,
          unit_amount: data.unit_amount ?? null,
          currency: data.currency,
        },
      },
    }
  },

  outputs: {
    price: {
      type: 'json',
      description: 'The updated price object',
    },
    metadata: {
      type: 'json',
      description: 'Price metadata',
      properties: {
        id: { type: 'string', description: 'Stripe unique identifier' },
        product: { type: 'string', description: 'Associated product ID' },
        unit_amount: {
          type: 'number',
          description: 'Amount in smallest currency unit (e.g., cents)',
          optional: true,
        },
        currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
      },
    },
  },
}
