import Stripe from 'stripe'
import type { InvoiceResponse, UpdateInvoiceParams } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Update Invoice Tool
 * Uses official stripe SDK for invoice updates
 */

export const stripeUpdateInvoiceTool: ToolConfig<UpdateInvoiceParams, InvoiceResponse> = {
  id: 'stripe_update_invoice',
  name: 'Stripe Update Invoice',
  description: 'Update an existing invoice',
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
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the invoice',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set of key-value pairs',
    },
    auto_advance: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Auto-finalize the invoice',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Updates invoice with optional fields
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare update data
      const updateData: Stripe.InvoiceUpdateParams = {}
      if (params.description) updateData.description = params.description
      if (params.auto_advance !== undefined) updateData.auto_advance = params.auto_advance
      if (params.metadata) updateData.metadata = params.metadata

      // Update invoice using SDK
      const invoice = await stripe.invoices.update(params.id, updateData)

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
        error: `STRIPE_UPDATE_INVOICE_ERROR: Failed to update invoice - ${errorDetails}`,
      }
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'The updated invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
    },
  },
}
