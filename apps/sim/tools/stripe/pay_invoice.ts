import type { InvoiceResponse, PayInvoiceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripePayInvoiceTool: ToolConfig<PayInvoiceParams, InvoiceResponse> = {
  id: 'stripe_pay_invoice',
  name: 'Stripe Pay Invoice',
  description: 'Pay an invoice',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Stripe API key (secret key)',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invoice ID (e.g., in_1234567890)',
    },
    paid_out_of_band: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark invoice as paid out of band',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/invoices/${params.id}/pay`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.paid_out_of_band !== undefined) {
        body.paid_out_of_band = params.paid_out_of_band.toString()
      }
      return body
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
      type: 'json',
      description: 'The paid invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
    },
  },
}
