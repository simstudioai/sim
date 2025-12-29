import QuickBooks from 'node-quickbooks'
import type { ExpenseResponse, RetrieveExpenseParams } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksRetrieveExpenseTool: ToolConfig<RetrieveExpenseParams, ExpenseResponse> = {
  id: 'quickbooks_retrieve_expense',
  name: 'QuickBooks Retrieve Expense',
  description: 'Retrieve a specific expense from QuickBooks Online',
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
      description: 'Expense ID to retrieve',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', undefined
      )

      const expense = await new Promise<any>((resolve, reject) => {
        qbo.getPurchase(params.Id, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          expense,
          metadata: {
            Id: expense.Id,
            TotalAmt: expense.TotalAmt,
            TxnDate: expense.TxnDate,
            PaymentType: expense.PaymentType,
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_RETRIEVE_EXPENSE_ERROR: ${error.message || 'Failed to retrieve expense'}`,
      }
    }
  },

  outputs: {
    expense: {
      type: 'json',
      description: 'The retrieved QuickBooks expense object',
    },
    metadata: {
      type: 'json',
      description: 'Expense summary metadata',
    },
  },
}
