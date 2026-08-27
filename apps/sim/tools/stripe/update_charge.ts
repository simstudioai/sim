import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { ChargeResponse, UpdateChargeParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

const DELIVERY = defineStripeKeyedSite(
  'stripe_update_charge',
  'the edit would be re-applied over any change made in between, and an update that sets receipt_email mails the cardholder a second receipt'
)

export const stripeUpdateChargeTool: ToolConfig<
  UpdateChargeParams & StripeDeliveryContextParams,
  ChargeResponse
> = {
  id: 'stripe_update_charge',
  name: 'Stripe Update Charge',
  description: 'Update an existing charge',
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
      description: 'Charge ID (e.g., ch_1234567890)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated metadata',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/charges/${params.id}`,
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

      if (params.description) formData.append('description', params.description)

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
        charge: data,
        metadata: {
          id: data.id,
          status: data.status,
          amount: data.amount,
          currency: data.currency,
          paid: data.paid,
        },
      },
    }
  },

  outputs: {
    charge: {
      type: 'json',
      description: 'The updated Charge object',
    },
    metadata: {
      type: 'json',
      description: 'Charge metadata including ID, status, amount, currency, and paid status',
      properties: {
        id: { type: 'string', description: 'Stripe unique identifier' },
        status: { type: 'string', description: 'Current state of the resource' },
        amount: { type: 'number', description: 'Amount in smallest currency unit (e.g., cents)' },
        currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
        paid: { type: 'boolean', description: 'Whether payment has been received' },
      },
    },
  },
}
