import Stripe from 'stripe'
import type { FinalizeInvoiceParams, InvoiceResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Finalize Invoice Tool
 * Uses official stripe SDK to finalize draft invoices
 */

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

  /**
   * SDK-based execution using stripe SDK
   * Finalizes a draft invoice making it immutable
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare finalize options
      const finalizeOptions: Stripe.InvoiceFinalizeInvoiceParams = {}
      if (params.auto_advance !== undefined) finalizeOptions.auto_advance = params.auto_advance

      // Finalize invoice using SDK
      const invoice = await stripe.invoices.finalizeInvoice(params.id, finalizeOptions)

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
        error: `STRIPE_FINALIZE_INVOICE_ERROR: Failed to finalize invoice - ${errorDetails}`,
      }
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
