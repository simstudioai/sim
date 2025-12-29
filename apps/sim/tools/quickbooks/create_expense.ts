import QuickBooks from 'node-quickbooks'
import type { CreateExpenseParams, ExpenseResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import { validateDate } from '@/tools/financial-validation'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksCreateExpense')

export const quickbooksCreateExpenseTool: ToolConfig<CreateExpenseParams, ExpenseResponse> = {
  id: 'quickbooks_create_expense',
  name: 'QuickBooks Create Expense',
  description: 'Create a new expense in QuickBooks Online',
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
    AccountRef: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account reference: { value: "accountId", name: "Account Name" }',
    },
    Line: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of expense line items',
    },
    PaymentType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Payment type: Cash, Check, or CreditCard',
    },
    TxnDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction date (YYYY-MM-DD format). Defaults to today.',
    },
    EntityRef: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Entity reference (vendor, customer): { value: "entityId", name: "Entity Name" }',
    },
    DocNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document number (e.g., check number)',
    },
    PrivateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Private note for internal use',
    },
  },

  directExecution: async (params) => {
    try {
      // Validate transaction date if provided
      if (params.TxnDate) {
        const txnDateValidation = validateDate(params.TxnDate, {
          fieldName: 'transaction date',
          allowFuture: false,
          required: false,
        })
        if (!txnDateValidation.valid) {
          logger.error('Transaction date validation failed', { error: txnDateValidation.error })
          return {
            success: false,
            output: {},
            error: `QUICKBOOKS_VALIDATION_ERROR: ${txnDateValidation.error}`,
          }
        }
      }

      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', undefined
      )

      const expense: Record<string, any> = {
        AccountRef: params.AccountRef,
        Line: params.Line,
        PaymentType: params.PaymentType,
      }

      if (params.TxnDate) expense.TxnDate = params.TxnDate
      if (params.EntityRef) expense.EntityRef = params.EntityRef
      if (params.DocNumber) expense.DocNumber = params.DocNumber
      if (params.PrivateNote) expense.PrivateNote = params.PrivateNote

      const createdExpense = await new Promise<any>((resolve, reject) => {
        qbo.createPurchase(expense, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          expense: createdExpense,
          metadata: {
            Id: createdExpense.Id,
            TotalAmt: createdExpense.TotalAmt,
            TxnDate: createdExpense.TxnDate,
            PaymentType: createdExpense.PaymentType,
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
        error: `QUICKBOOKS_CREATE_EXPENSE_ERROR: Failed to create expense - ${errorDetails}`,
      }
    }
  },

  outputs: {
    expense: {
      type: 'json',
      description: 'The created QuickBooks expense object',
    },
    metadata: {
      type: 'json',
      description: 'Expense summary metadata',
    },
  },
}
