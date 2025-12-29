import Stripe from 'stripe'
import type { CreateInvoiceParams, InvoiceResponse } from '@/tools/stripe/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Stripe Create Invoice Tool
 * Uses official stripe SDK for invoice creation
 */

export const stripeCreateInvoiceTool: ToolConfig<CreateInvoiceParams, InvoiceResponse> = {
  id: 'stripe_create_invoice',
  name: 'Stripe Create Invoice',
  description: 'Create a new invoice',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (secret key)',
    },
    customer: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID (e.g., cus_1234567890)',
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
    collection_method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Collection method: charge_automatically or send_invoice',
    },
  },

  /**
   * SDK-based execution using stripe SDK
   * Creates invoice with optional auto-advance and collection method
   */
  directExecution: async (params) => {
    try {
      // Initialize Stripe SDK client
      const stripe = new Stripe(params.apiKey, {
        apiVersion: '2025-08-27.basil',
      })

      // Prepare invoice data
      const invoiceData: Stripe.InvoiceCreateParams = {
        customer: params.customer,
      }

      if (params.description) invoiceData.description = params.description
      if (params.auto_advance !== undefined) invoiceData.auto_advance = params.auto_advance
      if (params.collection_method) {
        invoiceData.collection_method = params.collection_method as Stripe.InvoiceCreateParams.CollectionMethod
      }
      if (params.metadata) invoiceData.metadata = params.metadata

      // Create invoice using SDK
      const invoice = await stripe.invoices.create(invoiceData)

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
        error: `STRIPE_CREATE_INVOICE_ERROR: Failed to create invoice - ${errorDetails}`,
      }
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'The created invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata',
    },
  },
}
