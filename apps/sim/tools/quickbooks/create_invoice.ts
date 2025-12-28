import QuickBooks from 'node-quickbooks'
import type { CreateInvoiceParams, InvoiceResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateInvoiceTool: ToolConfig<CreateInvoiceParams, InvoiceResponse> = {
  id: 'quickbooks_create_invoice',
  name: 'QuickBooks Create Invoice',
  description: 'Create a new invoice in QuickBooks Online',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks company ID (realm ID)',
    },
    CustomerRef: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer reference: { value: "customerId", name: "Customer Name" }',
    },
    Line: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of line items for the invoice',
    },
    TxnDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction date (YYYY-MM-DD format). Defaults to today.',
    },
    DueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date (YYYY-MM-DD format)',
    },
    DocNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Invoice number (auto-generated if not provided)',
    },
    BillEmail: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing email: { Address: "email@example.com" }',
    },
    BillAddr: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing address object',
    },
    ShipAddr: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Shipping address object',
    },
    CustomField: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of custom fields',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
      )

      const invoice: Record<string, any> = {
        CustomerRef: params.CustomerRef,
        Line: params.Line,
      }

      if (params.TxnDate) invoice.TxnDate = params.TxnDate
      if (params.DueDate) invoice.DueDate = params.DueDate
      if (params.DocNumber) invoice.DocNumber = params.DocNumber
      if (params.BillEmail) invoice.BillEmail = params.BillEmail
      if (params.BillAddr) invoice.BillAddr = params.BillAddr
      if (params.ShipAddr) invoice.ShipAddr = params.ShipAddr
      if (params.CustomField) invoice.CustomField = params.CustomField

      const createdInvoice = await new Promise<any>((resolve, reject) => {
        qbo.createInvoice(invoice, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          invoice: createdInvoice,
          metadata: {
            Id: createdInvoice.Id,
            DocNumber: createdInvoice.DocNumber,
            TotalAmt: createdInvoice.TotalAmt,
            Balance: createdInvoice.Balance,
            TxnDate: createdInvoice.TxnDate,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_CREATE_INVOICE_ERROR',
          message: error.message || 'Failed to create invoice',
          details: error,
        },
      }
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'The created QuickBooks invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice summary metadata',
    },
  },
}
