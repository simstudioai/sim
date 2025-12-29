import Stripe from 'stripe'
import type { InvoiceResponse, RetrieveInvoiceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Retrieve Invoice Tool
 * Uses official stripe SDK for invoice retrieval
 */

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

  /**
   * SDK-based execution using stripe SDK
   * Retrieves invoice by ID with full invoice data
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Retrieve invoice using SDK
      const invoice = await stripe.invoices.retrieve(params.id)

      return {
        success: true,
        output: {
          invoice,
          metadata: {
            id: invoice.id,
            status: invoice.status,
            amount_due: invoice.amount_due,
            currency: invoice.currency,
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
        error: `STRIPE_RETRIEVE_INVOICE_ERROR: Failed to retrieve invoice - ${errorDetails}`,
      }
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
