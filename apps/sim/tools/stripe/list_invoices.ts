import { STRIPE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InvoiceListResponse, ListInvoicesParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeListInvoicesTool: ToolConfig<ListInvoicesParams, InvoiceListResponse> = {
  id: 'stripe_list_invoices',
  name: 'Stripe List Invoices',
  description: 'List all invoices',
  version: '1.0.0',
  oauth: STRIPE_CREDENTIAL_OAUTH,

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
    starting_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Next-page cursor: last invoice ID from the previous page. Do not combine with ending_before.',
    },
    ending_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Previous-page cursor: first invoice ID from the current page. Do not combine with starting_after.',
    },
  },

  request: {
    url: (params) => {
      if (params.starting_after && params.ending_before) {
        throw new Error('Provide either starting_after or ending_before, not both')
      }
      const url = new URL('https://api.stripe.com/v1/invoices')
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.starting_after) url.searchParams.append('starting_after', params.starting_after)
      if (params.ending_before) url.searchParams.append('ending_before', params.ending_before)
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

      properties: {
        count: { type: 'number', description: 'Number of items returned' },
        has_more: { type: 'boolean', description: 'Whether more items exist beyond this page' },
      },
    },
  },
}
