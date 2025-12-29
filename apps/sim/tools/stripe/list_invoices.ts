import Stripe from 'stripe'
import type { InvoiceListResponse, ListInvoicesParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe List Invoices Tool
 * Uses official stripe SDK for invoice listing with pagination and filtering
 */

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

  /**
   * SDK-based execution using stripe SDK
   * Lists invoices with optional filtering and pagination
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare list options
      const listOptions: Stripe.InvoiceListParams = {}
      if (params.limit) listOptions.limit = params.limit
      if (params.customer) listOptions.customer = params.customer
      if (params.status) listOptions.status = params.status as Stripe.InvoiceListParams.Status

      // List invoices using SDK
      const invoiceList = await stripe.invoices.list(listOptions)

      return {
        success: true,
        output: {
          invoices: invoiceList.data || [],
          metadata: {
            count: invoiceList.data.length,
            has_more: invoiceList.has_more || false,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `STRIPE_LIST_INVOICES_ERROR: Failed to list invoices - ${errorDetails}`,
      }
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
