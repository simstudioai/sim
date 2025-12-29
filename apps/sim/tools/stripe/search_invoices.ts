import Stripe from 'stripe'
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

  directExecution: async (params) => {
    try {
      const stripe = new Stripe(params.apiKey, { apiVersion: '2025-08-27.basil' })
      const searchOptions: Stripe.InvoiceSearchParams = { query: params.query }
      if (params.limit) searchOptions.limit = params.limit
      const searchResult = await stripe.invoices.search(searchOptions)
      return {
        success: true,
        output: {
          invoices: searchResult.data || [],
          metadata: { count: searchResult.data.length, has_more: searchResult.has_more || false },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `STRIPE_SEARCH_INVOICES_ERROR: Failed to search invoices - ${errorDetails}`,
      }
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
