import type { InvoiceListResponse, ListInvoicesParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListInvoicesTool: ToolConfig<ListInvoicesParams, InvoiceListResponse> = {
  id: 'stripe_list_invoices',
  name: 'Stripe List Invoices',
  description: 'List all invoices',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 10, max 100)',
    },
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by customer ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by invoice status',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/invoices')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.customer) url.searchParams.append('customer', params.customer)
      if (params.status) url.searchParams.append('status', params.status)
      return url.toString()
    },
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
        invoices: data.data || [],
        metadata: {
          count: (data.data || []).length,
          has_more: data.has_more || false,
        },
      },
    }
  },

  outputs: {
    invoices: {
      type: 'json',
      description: 'Array of invoice objects',
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
    },
  },
}
