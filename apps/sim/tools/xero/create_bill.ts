import { XeroClient } from 'xero-node'
import type { CreateBillParams, CreateBillResponse } from '@/tools/xero/types'
import type { ToolConfig } from '@/tools/types'
import { validateDate } from '@/tools/financial-validation'
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'

const logger = createLogger('XeroCreateBill')

/**
 * Xero Create Bill Tool
 * Uses official xero-node SDK for supplier bill creation (accounts payable)
 */
export const xeroCreateBillTool: ToolConfig<CreateBillParams, CreateBillResponse> = {
  id: 'xero_create_bill',
  name: 'Xero Create Bill',
  description: 'Create supplier bills (accounts payable) in Xero for expense tracking',
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
    supplierId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Xero contact ID (supplier)',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bill due date (YYYY-MM-DD, default: 30 days from now)',
    },
    lines: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bill line items: [{ description, quantity, unitAmount, accountCode? }]',
    },
    reference: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Supplier invoice number or reference',
    },
  },

  /**
   * SDK-based execution using xero-node XeroClient
   * Creates accounts payable bill for supplier invoices
   */
  directExecution: async (params) => {
    try {
      // Validate due date if provided (should be in future)
      if (params.dueDate) {
        const dueDateValidation = validateDate(params.dueDate, {
          fieldName: 'due date',
          allowPast: false,
          required: false,
        })
        if (!dueDateValidation.valid) {
          logger.error('Due date validation failed', { error: dueDateValidation.error })
          return {
            success: false,
            output: {},
            error: `XERO_VALIDATION_ERROR: ${dueDateValidation.error}`,
          }
        }
      }

      // Validate Xero credentials are configured
      if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) {
        logger.error('Xero credentials not configured')
        return {
          success: false,
          output: {},
          error: 'XERO_CONFIGURATION_ERROR: XERO_CLIENT_ID and XERO_CLIENT_SECRET must be configured in environment variables',
        }
      }

      // Initialize Xero SDK client with OAuth app credentials
      // These are required by the SDK constructor but not used for token-based auth
      const xero = new XeroClient({
        clientId: env.XERO_CLIENT_ID,
        clientSecret: env.XERO_CLIENT_SECRET,
      })

      // Set access token
      await xero.setTokenSet({
        access_token: params.apiKey,
        token_type: 'Bearer',
      })

      // Calculate due date
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
        accountCode: line.accountCode || '400', // Default to expense account
        lineAmount: line.quantity * line.unitAmount,
      }))

      // Calculate totals
      const subtotal = lineItems.reduce((sum, line) => sum + line.lineAmount, 0)

      // Create bill (ACCPAY type invoice)
      const bill = {
        type: 'ACCPAY' as any,
        contact: {
          contactID: params.supplierId,
        },
        dateString: new Date().toISOString().split('T')[0],
        dueDateString: dueDate,
        lineItems,
        reference: params.reference || '',
        status: 'DRAFT' as any,
      }

      // Create bill using SDK
      const response = await xero.accountingApi.createInvoices(params.tenantId, {
        invoices: [bill],
      })

      const createdBill = response.body.invoices?.[0]

      if (!createdBill) {
        throw new Error('Failed to create bill - no bill returned from Xero')
      }

      return {
        success: true,
        output: {
          bill: {
            id: createdBill.invoiceID || '',
            invoice_number: createdBill.invoiceNumber || 'DRAFT',
            supplier_name: createdBill.contact?.name || '',
            amount_due: createdBill.amountDue || subtotal,
            currency: createdBill.currencyCode || 'USD',
            status: createdBill.status || 'DRAFT',
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
            bill_id: createdBill.invoiceID || '',
            supplier_id: params.supplierId,
            total_amount: subtotal,
            status: createdBill.status || 'DRAFT',
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      logger.error('Failed to create Xero bill', { error: errorDetails })
      return {
        success: false,
        output: {},
        error: `XERO_BILL_ERROR: Failed to create Xero bill - ${errorDetails}`,
      }
    }
  },

  outputs: {
    bill: {
      type: 'json',
      description: 'Created bill with ID, number, and amount due',
    },
    lines: {
      type: 'json',
      description: 'Bill line items with calculations',
    },
    metadata: {
      type: 'json',
      description: 'Bill metadata for tracking',
    },
  },
}
