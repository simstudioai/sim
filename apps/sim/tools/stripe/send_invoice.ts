import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { InvoiceResponse, SendInvoiceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const DELIVERY = defineStripeKeyedSite(
  'stripe_send_invoice',
  'the customer would receive a second copy of the same invoice email'
)

export const stripeSendInvoiceTool: ToolConfig<
  SendInvoiceParams & StripeDeliveryContextParams,
  InvoiceResponse
> = {
  id: 'stripe_send_invoice',
  name: 'Stripe Send Invoice',
  description: 'Send an invoice to the customer',
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
      description: 'Invoice ID (e.g., in_1234567890)',
    },
  },

  request: {
    url: (params) =>
      `https://api.stripe.com/v1/invoices/${safeUrlPathSegment(params.id, 'id')}/send`,
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
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        invoice: data,
        metadata: {
          id: data.id,
          status: data.status,
          amount_due: data.amount_due,
          currency: data.currency,
        },
      },
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'The sent invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',

      properties: {
        id: { type: 'string', description: 'Stripe unique identifier' },
        status: { type: 'string', description: 'Current state of the resource' },
        amount_due: {
          type: 'number',
          description: 'Amount remaining to be paid in smallest currency unit',
        },
        currency: { type: 'string', description: 'Three-letter ISO currency code (lowercase)' },
      },
    },
  },
}
