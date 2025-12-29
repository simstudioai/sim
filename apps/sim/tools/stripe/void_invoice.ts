import Stripe from 'stripe'
import type { InvoiceResponse, VoidInvoiceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Void Invoice Tool
 * Uses official stripe SDK to void invoices
 */

export const stripeVoidInvoiceTool: ToolConfig<VoidInvoiceParams, InvoiceResponse> = {
  id: 'stripe_void_invoice',
  name: 'Stripe Void Invoice',
  description: 'Void an invoice',
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
      visibility: 'user-only',
      description: 'Invoice ID (e.g., in_1234567890) - requires human confirmation to void',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Voids an invoice marking it as uncollectible
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Void invoice using SDK
      const invoice = await stripe.invoices.voidInvoice(params.id)

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
        error: `STRIPE_VOID_INVOICE_ERROR: Failed to void invoice - ${errorDetails}`,
      }
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'The voided invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
    },
  },
}
