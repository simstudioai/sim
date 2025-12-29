import Stripe from 'stripe'
import type { DeleteInvoiceParams, InvoiceDeleteResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Delete Invoice Tool
 * Uses official stripe SDK to permanently delete draft invoices
 */

export const stripeDeleteInvoiceTool: ToolConfig<DeleteInvoiceParams, InvoiceDeleteResponse> = {
  id: 'stripe_delete_invoice',
  name: 'Stripe Delete Invoice',
  description: 'Permanently delete a draft invoice',
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
      description: 'Invoice ID (e.g., in_1234567890) - requires human confirmation for deletion',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Permanently deletes draft invoice (only works on draft status)
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Delete invoice using SDK
      const deletionConfirmation = await stripe.invoices.del(params.id)

      return {
        success: true,
        output: {
          deleted: deletionConfirmation.deleted,
          id: deletionConfirmation.id,
          metadata: {
            id: deletionConfirmation.id,
            deleted: deletionConfirmation.deleted,
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
        error: `STRIPE_DELETE_INVOICE_ERROR: Failed to delete invoice - ${errorDetails}`,
      }
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the invoice was deleted',
    },
    id: {
      type: 'string',
      description: 'The ID of the deleted invoice',
    },
    metadata: {
      type: 'json',
      description: 'Deletion metadata',
    },
  },
}
