import QuickBooks from 'node-quickbooks'
import type { CreateBillParams, BillResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import { validateDate } from '@/tools/financial-validation'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksCreateBill')

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
      // Validate transaction date if provided (must be in past or today)
      if (params.TxnDate) {
        const txnDateValidation = validateDate(params.TxnDate, {
          fieldName: 'transaction date',
          allowFuture: false,
          allowPast: true,
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

      // Validate due date if provided (can be past for overdue bills)
      if (params.DueDate) {
        const dueDateValidation = validateDate(params.DueDate, {
          fieldName: 'due date',
          allowPast: true,
          allowFuture: true,
          required: false,
        })
        if (!dueDateValidation.valid) {
          logger.error('Due date validation failed', { error: dueDateValidation.error })
          return {
            success: false,
            output: {},
            error: `QUICKBOOKS_VALIDATION_ERROR: ${dueDateValidation.error}`,
          }
        }
      }

      // Validate date relationship: transaction date must be before or equal to due date
      if (params.TxnDate && params.DueDate) {
        const txnDate = new Date(params.TxnDate)
        const dueDate = new Date(params.DueDate)
        if (txnDate > dueDate) {
          logger.error('Date relationship validation failed', {
            txnDate: params.TxnDate,
            dueDate: params.DueDate,
          })
          return {
            success: false,
            output: {},
            error: 'QUICKBOOKS_VALIDATION_ERROR: Transaction date cannot be after due date',
          }
        }
      }

      // Validate line item amounts
      if (Array.isArray(params.Line)) {
        for (let i = 0; i < params.Line.length; i++) {
          const line = params.Line[i]
          if (line.Amount !== undefined) {
            const amountValidation = validateFinancialAmount(line.Amount, {
              fieldName: `line item ${i + 1} amount`,
              allowZero: false,
              allowNegative: false,
              min: 0.01,
              max: 10000000,
            })

            if (!amountValidation.valid) {
              logger.error('Line item amount validation failed', {
                lineNumber: i + 1,
                error: amountValidation.error,
              })
              return {
                success: false,
                output: {},
                error: `QUICKBOOKS_VALIDATION_ERROR: ${amountValidation.error}`,
              }
            }

            // Update with sanitized amount
            if (amountValidation.sanitized !== undefined) {
              params.Line[i].Amount = amountValidation.sanitized
            }
          }
        }
      }

      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', undefined
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
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_CREATE_BILL_ERROR: Failed to create bill - ${errorDetails}`,
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
