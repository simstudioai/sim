import QuickBooks from 'node-quickbooks'
import type { CreateInvoiceParams, InvoiceResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import { validateFinancialAmount, validateDate } from '@/tools/financial-validation'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksCreateInvoice')

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

      // Validate due date if provided (can be past for overdue invoices)
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
              max: 10000000, // $10M max per line item
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
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      logger.error('Failed to create QuickBooks invoice', { error: errorDetails })
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_CREATE_INVOICE_ERROR: Failed to create invoice - ${errorDetails}`,
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
