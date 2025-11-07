import type { FinalizeInvoiceParams, InvoiceResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeFinalizeInvoiceTool: ToolConfig<FinalizeInvoiceParams, InvoiceResponse> = {
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
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
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
      type: 'json',
      description: 'The finalized invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
    },
  },
}
