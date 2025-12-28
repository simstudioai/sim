import Stripe from 'stripe'
import type { InvoiceResponse, SendInvoiceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Send Invoice Tool
 * Uses official stripe SDK to send invoices to customers
 */

export const stripeSendInvoiceTool: ToolConfig<SendInvoiceParams, InvoiceResponse> = {
  id: 'stripe_send_invoice',
  name: 'Stripe Send Invoice',
  description: 'Send an invoice to the customer',
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
   * Sends invoice email to customer
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Send invoice using SDK
      const invoice = await stripe.invoices.sendInvoice(params.id)

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
      return {
        success: false,
        error: {
          code: 'STRIPE_SEND_INVOICE_ERROR',
          message: error.message || 'Failed to send invoice',
          details: error,
        },
      }
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'The sent invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
    },
  },
}
