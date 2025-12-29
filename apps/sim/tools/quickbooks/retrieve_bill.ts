import QuickBooks from 'node-quickbooks'
import type { RetrieveBillParams, BillResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksRetrieveBillTool: ToolConfig<RetrieveBillParams, BillResponse> = {
  id: 'quickbooks_retrieve_bill',
  name: 'QuickBooks Retrieve Bill',
  description: 'Retrieve a specific bill by ID from QuickBooks Online',
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
      description: 'Bill ID to retrieve',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', undefined
      )

      const bill = await new Promise<any>((resolve, reject) => {
        qbo.getBill(params.Id, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          bill,
          metadata: {
            Id: bill.Id,
            DocNumber: bill.DocNumber,
            TotalAmt: bill.TotalAmt,
            Balance: bill.Balance,
            TxnDate: bill.TxnDate,
            DueDate: bill.DueDate,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_RETRIEVE_BILL_ERROR: ${error.message || 'Failed to retrieve bill'}`,
      }
    }
  },

  outputs: {
    bill: {
      type: 'json',
      description: 'The retrieved QuickBooks bill object',
    },
    metadata: {
      type: 'json',
      description: 'Bill summary metadata',
    },
  },
}
