import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { CaptureChargeParams, ChargeResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

const DELIVERY = defineStripeKeyedSite(
  'stripe_capture_charge',
  'an authorization would be captured twice and the cardholder would be billed again'
)

export const stripeCaptureChargeTool: ToolConfig<
  CaptureChargeParams & StripeDeliveryContextParams,
  ChargeResponse
> = {
  id: 'stripe_capture_charge',
  name: 'Stripe Capture Charge',
  description: 'Capture an uncaptured charge',
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
    amount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Amount to capture in cents (defaults to full amount)',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/charges/${params.id}/capture`,
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
      if (params.amount) {
        formData.append('amount', Number(params.amount).toString())
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
      description: 'The captured Charge object',
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
