import type { DeleteInvoiceParams, InvoiceDeleteResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeDeleteInvoiceTool: ToolConfig<DeleteInvoiceParams, InvoiceDeleteResponse> = {
  id: 'stripe_delete_invoice',
  name: 'Stripe Delete Invoice',
  description: 'Permanently delete a draft invoice',
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
    method: 'DELETE',
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
        deleted: data.deleted,
        id: data.id,
        metadata: {
          id: data.id,
          deleted: data.deleted,
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the invoice was deleted',
    },
    id: {
      type: 'string',
      description: 'The ID of the deleted invoice',
    },
    metadata: {
      type: 'json',
      description: 'Deletion metadata',
    },
  },
}
