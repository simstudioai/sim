import Stripe from 'stripe'
import type { InvoiceResponse, PayInvoiceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Pay Invoice Tool
 * Uses official stripe SDK to pay invoices
 */

export const stripePayInvoiceTool: ToolConfig<PayInvoiceParams, InvoiceResponse> = {
  id: 'stripe_pay_invoice',
  name: 'Stripe Pay Invoice',
  description: 'Pay an invoice',
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
    paid_out_of_band: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark invoice as paid out of band',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Pays an invoice or marks it as paid out of band
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2024-12-18.acacia',
      })

      // Prepare pay options
      const payOptions: Stripe.InvoicePayParams = {}
      if (params.paid_out_of_band !== undefined) {
        payOptions.paid_out_of_band = params.paid_out_of_band
      }

      // Pay invoice using SDK
      const invoice = await stripe.invoices.pay(params.id, payOptions)

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
          code: 'STRIPE_PAY_INVOICE_ERROR',
          message: error.message || 'Failed to pay invoice',
          details: error,
        },
      }
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'The paid invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
    },
  },
}
