import type { CreateInvoiceParams, InvoiceResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeCreateInvoiceTool: ToolConfig<CreateInvoiceParams, InvoiceResponse> = {
  id: 'stripe_create_invoice',
  name: 'Stripe Create Invoice',
  description: 'Create a new invoice',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    customer: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID (e.g., cus_1234567890)',
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
    collection_method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Collection method: charge_automatically or send_invoice',
    },
  },

  request: {
    url: () => 'https://api.stripe.com/v1/invoices',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const formData = new URLSearchParams()
      formData.append('customer', params.customer)

      if (params.description) formData.append('description', params.description)
      if (params.auto_advance !== undefined) {
        formData.append('auto_advance', String(params.auto_advance))
      }
      if (params.collection_method) formData.append('collection_method', params.collection_method)

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
      description: 'The created invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
    },
  },
}
