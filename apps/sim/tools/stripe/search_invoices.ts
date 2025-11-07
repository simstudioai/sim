import type { InvoiceListResponse, SearchInvoicesParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

export const stripeSearchInvoicesTool: ToolConfig<SearchInvoicesParams, InvoiceListResponse> = {
  id: 'stripe_search_invoices',
  name: 'Stripe Search Invoices',
  description: 'Search for invoices using query syntax',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query (e.g., "customer:\'cus_1234567890\'")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 10, max 100)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.stripe.com/v1/invoices/search')
      url.searchParams.append('query', params.query)
      if (params.limit) url.searchParams.append('limit', params.limit.toString())
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
      description: 'Array of matching invoice objects',
    },
    metadata: {
      type: 'json',
      description: 'Search metadata',
    },
  },
}
