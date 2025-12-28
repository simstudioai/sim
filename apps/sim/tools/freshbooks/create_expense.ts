import { Client } from '@freshbooks/api'
import type { CreateExpenseParams, CreateExpenseResponse } from '@/tools/freshbooks/types'
import type { ToolConfig } from '@/tools/types'

/**
 * FreshBooks Create Expense Tool
 * Uses official @freshbooks/api SDK for expense tracking
 */
export const freshbooksCreateExpenseTool: ToolConfig<
  CreateExpenseParams,
  CreateExpenseResponse
> = {
  id: 'freshbooks_create_expense',
  name: 'FreshBooks Create Expense',
  description:
    'Track business expenses with vendor, category, and optional client/project attribution',
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
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Expense amount in dollars',
    },
    vendor: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Vendor or merchant name',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expense date (YYYY-MM-DD, default: today)',
    },
    categoryId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'FreshBooks expense category ID',
    },
    clientId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Client ID if expense is billable to client',
    },
    projectId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project ID for project-based expense tracking',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expense notes or description',
    },
    taxName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tax name (e.g., "Sales Tax", "VAT")',
    },
    taxPercent: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tax percentage (e.g., 7.5 for 7.5%)',
    },
  },

  /**
   * SDK-based execution using @freshbooks/api Client
   * Creates expense with tax calculations and client billing
   */
  directExecution: async (params) => {
    try {
      // Initialize FreshBooks SDK client
      const client = new Client(params.apiKey, {
        apiUrl: 'https://api.freshbooks.com',
      })

      // Calculate tax if provided
      const taxAmount = params.taxPercent ? (params.amount * params.taxPercent) / 100 : 0

      // Prepare expense data
      const expenseData: any = {
        amount: {
          amount: params.amount.toString(),
          code: 'USD',
        },
        vendor: params.vendor,
        date: params.date || new Date().toISOString().split('T')[0],
        notes: params.notes || '',
      }

      // Add optional fields
      if (params.categoryId) {
        expenseData.categoryid = params.categoryId
      }
      if (params.clientId) {
        expenseData.clientid = params.clientId
      }
      if (params.projectId) {
        expenseData.projectid = params.projectId
      }
      if (params.taxName && taxAmount > 0) {
        expenseData.taxName1 = params.taxName
        expenseData.taxAmount1 = {
          amount: taxAmount.toString(),
          code: 'USD',
        }
      }

      // Create expense using SDK
      const response = await client.expenses.create(params.accountId, expenseData)
      const expense = response.data

      return {
        success: true,
        output: {
          expense: {
            id: expense.id,
            amount: params.amount,
            currency: 'USD',
            vendor: params.vendor,
            date: expenseData.date,
            category: expense.category?.category || 'Uncategorized',
            client_id: params.clientId,
            project_id: params.projectId,
            notes: params.notes,
          },
          metadata: {
            expense_id: expense.id,
            amount: params.amount,
            vendor: params.vendor,
            created_at: new Date().toISOString().split('T')[0],
          },
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'FRESHBOOKS_EXPENSE_ERROR',
          message: error.message || 'Failed to create FreshBooks expense',
          details: error.response?.data || error,
        },
      }
    }
  },

  outputs: {
    expense: {
      type: 'json',
      description: 'Created expense with amount, vendor, and categorization',
    },
    metadata: {
      type: 'json',
      description: 'Expense metadata for tracking',
    },
  },
}
