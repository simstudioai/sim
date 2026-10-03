import {
  defineStripeKeyedSite,
  type StripeDeliveryContextParams,
  stripeIdempotencyHeader,
} from '@/tools/stripe/idempotency'
import type { FinalizeInvoiceParams, InvoiceResponse } from '@/tools/stripe/types'
import { INVOICE_METADATA_OUTPUT_PROPERTIES, INVOICE_OUTPUT } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

const DELIVERY = defineStripeKeyedSite(
  'stripe_finalize_invoice',
  'the invoice would be finalized twice, and finalization can both email the customer the bill and charge their saved card'
)

export const stripeFinalizeInvoiceTool: ToolConfig<
  FinalizeInvoiceParams & StripeDeliveryContextParams,
  InvoiceResponse
> = {
  id: 'stripe_finalize_invoice',
  name: 'Stripe Finalize Invoice',
  description: 'Finalize a draft invoice',
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
    auto_advance: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Auto-advance the invoice',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/invoices/${params.id}/finalize`,
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

      if (params.auto_advance !== undefined) {
        formData.append('auto_advance', String(params.auto_advance))
      }

      return { body: formData.toString() }
    },
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
      ...INVOICE_OUTPUT,
      description: 'The finalized invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
      properties: INVOICE_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
