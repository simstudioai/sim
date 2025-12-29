import QuickBooks from 'node-quickbooks'
import type { ListBillsParams, ListBillsResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import {
  validateQuickBooksQuery,
  buildDefaultQuery,
  addPaginationToQuery,
} from '@/tools/quickbooks/utils'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksListBills')

export const quickbooksListBillsTool: ToolConfig<ListBillsParams, ListBillsResponse> = {
  id: 'quickbooks_list_bills',
  name: 'QuickBooks List Bills',
  description: 'Query and list bills in QuickBooks Online',
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
      description: 'SQL-like query string (e.g., "SELECT * FROM Bill WHERE Balance > \'0\'")',
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
        buildDefaultQuery('Bill', params.maxResults, params.startPosition)

      // Apply pagination to custom queries
      const queryWithPagination = params.query
        ? addPaginationToQuery(rawQuery, params.maxResults, params.startPosition)
        : rawQuery

      const query = validateQuickBooksQuery(queryWithPagination, 'Bill')

      const bills = await new Promise<any[]>((resolve, reject) => {
        qbo.findBills(query, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result.QueryResponse?.Bill || [])
        })
      })

      return {
        success: true,
        output: {
          bills,
          metadata: {
            count: bills.length,
            startPosition: params.startPosition || 1,
            maxResults: params.maxResults || 100,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      logger.error('Failed to list bills', { error: errorDetails })
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_LIST_BILLS_ERROR: Failed to list bills - ${errorDetails}`,
      }
    }
  },

  outputs: {
    bills: {
      type: 'json',
      description: 'Array of QuickBooks bill objects',
    },
    metadata: {
      type: 'json',
      description: 'Query metadata including count and pagination info',
    },
  },
}
