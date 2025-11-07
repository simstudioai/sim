import type { InvoiceResponse, RetrieveInvoiceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeRetrieveInvoiceTool: ToolConfig<RetrieveInvoiceParams, InvoiceResponse> = {
  id: 'stripe_retrieve_invoice',
  name: 'Stripe Retrieve Invoice',
  description: 'Retrieve an existing invoice by ID',
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
    url: (params) => `https://api.stripe.com/v1/invoices/${params.id}`,
    method: 'GET',
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
      description: 'The retrieved invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
    },
  },
}
