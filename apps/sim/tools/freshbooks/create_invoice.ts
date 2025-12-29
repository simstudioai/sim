import { Client } from '@freshbooks/api'
import type { CreateInvoiceParams, CreateInvoiceResponse } from '@/tools/freshbooks/types'
import type { ToolConfig } from '@/tools/types'
import { validateDate } from '@/tools/financial-validation'
import { createLogger } from '@sim/logger'

const logger = createLogger('FreshBooksCreateInvoice')

/**
 * FreshBooks Create Invoice Tool
 * Uses official @freshbooks/api SDK for type-safe invoice creation
 */
export const freshbooksCreateInvoiceTool: ToolConfig<
  CreateInvoiceParams,
  CreateInvoiceResponse
> = {
  id: 'freshbooks_create_invoice',
  name: 'FreshBooks Create Invoice',
  description: 'Create professional invoices with automatic calculations and optional auto-send',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'FreshBooks OAuth access token',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'FreshBooks account ID',
    },
    clientId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'FreshBooks client ID to invoice',
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
      description:
        'Invoice line items: [{ name, description?, quantity, unitCost }]',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Invoice notes or terms',
    },
    currencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Currency code (default: "USD")',
    },
    autoSend: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Automatically send invoice to client email (default: false)',
    },
  },

  /**
   * SDK-based execution using @freshbooks/api Client
   * Bypasses HTTP layer for better error handling and type safety
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
            error: `FRESHBOOKS_VALIDATION_ERROR: ${dueDateValidation.error}`,
          }
        }
      }

      // Initialize FreshBooks SDK client
      const client = new Client(params.apiKey, {
        apiUrl: 'https://api.freshbooks.com',
      })

      // Calculate due date (30 days from now if not specified)
      const formatDate = (date: Date) => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }

      const dueDate = params.dueDate || (() => {
        const date = new Date()
        date.setDate(date.getDate() + 30)
        return formatDate(date)
      })()
      const [dueYear, dueMonth, dueDay] = dueDate.split('-').map(Number)
      const dueDateValue = new Date(dueYear, dueMonth - 1, dueDay)

      // Transform line items to FreshBooks format
      const lines = params.lines.map((line: any) => ({
        name: line.name,
        description: line.description || '',
        qty: line.quantity,
        unitCost: {
          amount: line.unitCost.toString(),
          code: params.currencyCode || 'USD',
        },
      }))

      // Calculate total amount
      const totalAmount = params.lines.reduce(
        (sum: number, line: any) => sum + line.quantity * line.unitCost,
        0
      )

      // Create invoice using SDK
      const invoiceData = {
        customerId: params.clientId,
        createDate: new Date(),
        dueDate: dueDateValue,
        currencyCode: params.currencyCode || 'USD',
        lines,
        notes: params.notes || '',
      }

      const response = await client.invoices.create(invoiceData, params.accountId)

      if (!response.data) {
        throw new Error('FreshBooks API returned no data')
      }

      const invoice = response.data

      // Auto-send if requested
      if (params.autoSend && invoice.id) {
        await client.invoices.update(params.accountId, String(invoice.id), {
          actionEmail: true,
        })
      }

      return {
        success: true,
        output: {
          invoice: {
            id: invoice.id,
            invoice_number: invoice.invoiceNumber || `INV-${invoice.id}`,
            client_id: params.clientId,
            amount_due: totalAmount,
            currency: params.currencyCode || 'USD',
            status: invoice.status || 'draft',
            created: new Date().toISOString().split('T')[0],
            due_date: dueDate,
          },
          lines: params.lines.map((line: any) => ({
            name: line.name,
            quantity: line.quantity,
            unit_cost: line.unitCost,
            total: line.quantity * line.unitCost,
          })),
          metadata: {
            invoice_id: invoice.id,
            invoice_number: invoice.invoiceNumber || `INV-${invoice.id}`,
            total_amount: totalAmount,
            status: invoice.status || 'draft',
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `FRESHBOOKS_INVOICE_ERROR: Failed to create FreshBooks invoice - ${errorDetails}`,
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
