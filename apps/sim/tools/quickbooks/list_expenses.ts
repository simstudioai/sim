import QuickBooks from 'node-quickbooks'
import type { ListExpensesParams, ListExpensesResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import {
  validateQuickBooksQuery,
  buildDefaultQuery,
  addPaginationToQuery,
} from '@/tools/quickbooks/utils'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksListExpenses')

export const quickbooksListExpensesTool: ToolConfig<ListExpensesParams, ListExpensesResponse> = {
  id: 'quickbooks_list_expenses',
  name: 'QuickBooks List Expenses',
  description: 'List expenses from QuickBooks Online with optional query',
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
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'SQL-like query (e.g., "SELECT * FROM Purchase WHERE PaymentType = \'CreditCard\' ORDERBY TxnDate DESC")',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default: 100)',
    },
    startPosition: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Starting position for pagination (default: 1)',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', undefined
      )

      // Build and validate query with pagination (Purchase is the QuickBooks entity name)
      const rawQuery =
        params.query ||
        buildDefaultQuery('Purchase', params.maxResults, params.startPosition)

      // Apply pagination to custom queries
      const queryWithPagination = params.query
        ? addPaginationToQuery(rawQuery, params.maxResults, params.startPosition)
        : rawQuery

      const query = validateQuickBooksQuery(queryWithPagination, 'Purchase')

      const expenses = await new Promise<any[]>((resolve, reject) => {
        qbo.findPurchases(query, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result.QueryResponse?.Purchase || [])
        })
      })

      return {
        success: true,
        output: {
          expenses,
          metadata: {
            count: expenses.length,
            startPosition: params.startPosition || 1,
            maxResults: params.maxResults || 100,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      logger.error('Failed to list expenses', { error: errorDetails })
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_LIST_EXPENSES_ERROR: Failed to list expenses - ${errorDetails}`,
      }
    }
  },

  outputs: {
    expenses: {
      type: 'json',
      description: 'Array of QuickBooks expense objects',
    },
    metadata: {
      type: 'json',
      description: 'Pagination metadata',
    },
  },
}
