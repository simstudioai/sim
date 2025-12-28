import { XeroClient } from 'xero-node'
import type { CreateInvoiceParams, CreateInvoiceResponse } from '@/tools/xero/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Xero Create Invoice Tool
 * Uses official xero-node SDK for type-safe invoice creation
 */
export const xeroCreateInvoiceTool: ToolConfig<CreateInvoiceParams, CreateInvoiceResponse> = {
  id: 'xero_create_invoice',
  name: 'Xero Create Invoice',
  description: 'Create sales invoices (accounts receivable) in Xero with automatic tax calculations',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Xero OAuth access token',
    },
    tenantId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Xero organization tenant ID',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Xero contact ID (customer)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Invoice type: "ACCREC" (sales invoice, default) or "ACCPAY" (bill)',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Invoice due date (YYYY-MM-DD, default: 30 days from now)',
    },
    lines: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invoice line items: [{ description, quantity, unitAmount, accountCode? }]',
    },
    reference: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Invoice reference or purchase order number',
    },
  },

  /**
   * SDK-based execution using xero-node XeroClient
   * Creates invoice with automatic tax calculations
   */
  directExecution: async (params) => {
    try {
      // Initialize Xero SDK client
      const xero = new XeroClient({
        clientId: '', // Not needed for token-based auth
        clientSecret: '', // Not needed for token-based auth
      })

      // Set access token for this request
      await xero.setTokenSet({
        access_token: params.apiKey,
        token_type: 'Bearer',
      })

      // Calculate due date (30 days from now if not specified)
      const dueDate = params.dueDate || (() => {
        const date = new Date()
        date.setDate(date.getDate() + 30)
        return date.toISOString().split('T')[0]
      })()

      // Transform line items to Xero format
      const lineItems = params.lines.map((line: any) => ({
        description: line.description,
        quantity: line.quantity,
        unitAmount: line.unitAmount,
        accountCode: line.accountCode || '200', // Default to sales account
        lineAmount: line.quantity * line.unitAmount,
      }))

      // Calculate totals
      const subtotal = lineItems.reduce((sum, line) => sum + line.lineAmount, 0)

      // Create invoice object
      const invoice = {
        type: params.type || 'ACCREC',
        contact: {
          contactID: params.contactId,
        },
        dateString: new Date().toISOString().split('T')[0],
        dueDateString: dueDate,
        lineItems,
        reference: params.reference || '',
        status: 'DRAFT',
      }

      // Create invoice using SDK
      const response = await xero.accountingApi.createInvoices(params.tenantId, {
        invoices: [invoice],
      })

      const createdInvoice = response.body.invoices?.[0]

      if (!createdInvoice) {
        throw new Error('Failed to create invoice - no invoice returned from Xero')
      }

      return {
        success: true,
        output: {
          invoice: {
            id: createdInvoice.invoiceID || '',
            invoice_number: createdInvoice.invoiceNumber || 'DRAFT',
            type: createdInvoice.type || 'ACCREC',
            contact_name: createdInvoice.contact?.name || '',
            amount_due: createdInvoice.amountDue || subtotal,
            currency: createdInvoice.currencyCode || 'USD',
            status: createdInvoice.status || 'DRAFT',
            created: new Date().toISOString().split('T')[0],
            due_date: dueDate,
          },
          lines: params.lines.map((line: any) => ({
            description: line.description,
            quantity: line.quantity,
            unit_amount: line.unitAmount,
            total: line.quantity * line.unitAmount,
          })),
          metadata: {
            invoice_id: createdInvoice.invoiceID || '',
            invoice_number: createdInvoice.invoiceNumber || 'DRAFT',
            total_amount: subtotal,
            status: createdInvoice.status || 'DRAFT',
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'XERO_INVOICE_ERROR',
          message: error.message || 'Failed to create Xero invoice',
          details: error.response?.body || error,
        },
      }
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'Created invoice with ID, number, amount, and status',
    },
    lines: {
      type: 'json',
      description: 'Invoice line items with calculations',
    },
    metadata: {
      type: 'json',
      description: 'Invoice metadata for tracking',
    },
  },
}
