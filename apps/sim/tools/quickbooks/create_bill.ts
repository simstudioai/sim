import QuickBooks from 'node-quickbooks'
import type { CreateBillParams, BillResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateBillTool: ToolConfig<CreateBillParams, BillResponse> = {
  id: 'quickbooks_create_bill',
  name: 'QuickBooks Create Bill',
  description: 'Create a new bill (accounts payable) in QuickBooks Online',
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
    VendorRef: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Vendor reference: { value: "vendorId", name: "Vendor Name" }',
    },
    Line: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of line items for the bill',
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
      description: 'Bill number',
    },
    PrivateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Private note for internal reference',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
      )

      const bill: Record<string, any> = {
        VendorRef: params.VendorRef,
        Line: params.Line,
      }

      if (params.TxnDate) bill.TxnDate = params.TxnDate
      if (params.DueDate) bill.DueDate = params.DueDate
      if (params.DocNumber) bill.DocNumber = params.DocNumber
      if (params.PrivateNote) bill.PrivateNote = params.PrivateNote

      const createdBill = await new Promise<any>((resolve, reject) => {
        qbo.createBill(bill, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          bill: createdBill,
          metadata: {
            Id: createdBill.Id,
            DocNumber: createdBill.DocNumber,
            TotalAmt: createdBill.TotalAmt,
            Balance: createdBill.Balance,
            TxnDate: createdBill.TxnDate,
            DueDate: createdBill.DueDate,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_CREATE_BILL_ERROR',
          message: error.message || 'Failed to create bill',
          details: error,
        },
      }
    }
  },

  outputs: {
    bill: {
      type: 'json',
      description: 'The created QuickBooks bill object',
    },
    metadata: {
      type: 'json',
      description: 'Bill summary metadata',
    },
  },
}
