import QuickBooks from 'node-quickbooks'
import type { ListPaymentsParams, ListPaymentsResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import {
  validateQuickBooksQuery,
  buildDefaultQuery,
  addPaginationToQuery,
} from '@/tools/quickbooks/utils'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksListPayments')

export const quickbooksListPaymentsTool: ToolConfig<ListPaymentsParams, ListPaymentsResponse> = {
  id: 'quickbooks_list_payments',
  name: 'QuickBooks List Payments',
  description: 'Query and list payments in QuickBooks Online',
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
      description: 'SQL-like query string (e.g., "SELECT * FROM Payment WHERE TotalAmt > \'100\'")',
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
        buildDefaultQuery('Payment', params.maxResults, params.startPosition)

      // Apply pagination to custom queries
      const queryWithPagination = params.query
        ? addPaginationToQuery(rawQuery, params.maxResults, params.startPosition)
        : rawQuery

      const query = validateQuickBooksQuery(queryWithPagination, 'Payment')

      const payments = await new Promise<any[]>((resolve, reject) => {
        qbo.findPayments(query, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result.QueryResponse?.Payment || [])
        })
      })

      return {
        success: true,
        output: {
          payments,
          metadata: {
            count: payments.length,
            startPosition: params.startPosition || 1,
            maxResults: params.maxResults || 100,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      logger.error('Failed to list payments', { error: errorDetails })
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_LIST_PAYMENTS_ERROR: Failed to list payments - ${errorDetails}`,
      }
    }
  },

  outputs: {
    payments: {
      type: 'json',
      description: 'Array of QuickBooks payment objects',
    },
    metadata: {
      type: 'json',
      description: 'Query metadata including count and pagination info',
    },
  },
}
