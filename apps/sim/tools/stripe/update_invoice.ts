import type { InvoiceResponse, UpdateInvoiceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeUpdateInvoiceTool: ToolConfig<UpdateInvoiceParams, InvoiceResponse> = {
  id: 'stripe_update_invoice',
  name: 'Stripe Update Invoice',
  description: 'Update an existing invoice',
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
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the invoice',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs',
    },
    auto_advance: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Auto-finalize the invoice',
    },
  },

  request: {
    url: (params) => `https://api.stripe.com/v1/invoices/${params.id}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.description) body.description = params.description
      if (params.auto_advance !== undefined) {
        body.auto_advance = params.auto_advance
      }

      if (params.metadata) {
        Object.entries(params.metadata).forEach(([key, value]) => {
          body[`metadata[${key}]`] = String(value)
        })
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
      description: 'The updated invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
    },
  },
}
