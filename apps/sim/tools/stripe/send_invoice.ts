import type { InvoiceResponse, SendInvoiceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeSendInvoiceTool: ToolConfig<SendInvoiceParams, InvoiceResponse> = {
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
    url: (params) => `https://api.stripe.com/v1/invoices/${params.id}/send`,
    method: 'POST',
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
    },
  },
}
