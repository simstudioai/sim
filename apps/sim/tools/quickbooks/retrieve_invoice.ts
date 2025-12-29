import QuickBooks from 'node-quickbooks'
import type { InvoiceResponse, RetrieveInvoiceParams } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksRetrieveInvoiceTool: ToolConfig<RetrieveInvoiceParams, InvoiceResponse> = {
  id: 'quickbooks_retrieve_invoice',
  name: 'QuickBooks Retrieve Invoice',
  description: 'Retrieve a specific invoice from QuickBooks Online',
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
    Id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Invoice ID to retrieve',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', undefined
      )

      const invoice = await new Promise<any>((resolve, reject) => {
        qbo.getInvoice(params.Id, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          invoice,
          metadata: {
            Id: invoice.Id,
            DocNumber: invoice.DocNumber,
            TotalAmt: invoice.TotalAmt,
            Balance: invoice.Balance,
            TxnDate: invoice.TxnDate,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_RETRIEVE_INVOICE_ERROR: ${error.message || 'Failed to retrieve invoice'}`,
      }
    }
  },

  outputs: {
    invoice: {
      type: 'json',
      description: 'The retrieved QuickBooks invoice object',
    },
    metadata: {
      type: 'json',
      description: 'Invoice summary metadata',
    },
  },
}
