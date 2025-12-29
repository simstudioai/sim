import QuickBooks from 'node-quickbooks'
import type { ListInvoicesParams, ListInvoicesResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import {
  validateQuickBooksQuery,
  buildDefaultQuery,
  addPaginationToQuery,
} from '@/tools/quickbooks/utils'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksListInvoices')

export const quickbooksListInvoicesTool: ToolConfig<ListInvoicesParams, ListInvoicesResponse> = {
  id: 'quickbooks_list_invoices',
  name: 'QuickBooks List Invoices',
  description: 'List invoices from QuickBooks Online with optional query',
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
        'SQL-like query (e.g., "SELECT * FROM Invoice WHERE TotalAmt > \'1000\' ORDERBY TxnDate DESC")',
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

      // Build and validate query with pagination
      const rawQuery =
        params.query ||
        buildDefaultQuery('Invoice', params.maxResults, params.startPosition)

      // Apply pagination to custom queries
      const queryWithPagination = params.query
        ? addPaginationToQuery(rawQuery, params.maxResults, params.startPosition)
        : rawQuery

      const query = validateQuickBooksQuery(queryWithPagination, 'Invoice')

      const invoices = await new Promise<any[]>((resolve, reject) => {
        qbo.findInvoices(query, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result.QueryResponse?.Invoice || [])
        })
      })

      return {
        success: true,
        output: {
          invoices,
          metadata: {
            count: invoices.length,
            startPosition: params.startPosition || 1,
            maxResults: params.maxResults || 100,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      logger.error('Failed to list invoices', { error: errorDetails })
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_LIST_INVOICES_ERROR: Failed to list invoices - ${errorDetails}`,
      }
    }
  },

  outputs: {
    invoices: {
      type: 'json',
      description: 'Array of QuickBooks invoice objects',
    },
    metadata: {
      type: 'json',
      description: 'Pagination metadata',
    },
  },
}
