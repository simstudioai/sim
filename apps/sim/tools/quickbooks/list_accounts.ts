import QuickBooks from 'node-quickbooks'
import type { ListAccountsParams, ListAccountsResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import {
  validateQuickBooksQuery,
  buildDefaultQuery,
  addPaginationToQuery,
} from '@/tools/quickbooks/utils'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksListAccounts')

export const quickbooksListAccountsTool: ToolConfig<ListAccountsParams, ListAccountsResponse> = {
  id: 'quickbooks_list_accounts',
  name: 'QuickBooks List Accounts',
  description: 'Query and list chart of accounts in QuickBooks Online',
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
        'SQL-like query string (e.g., "SELECT * FROM Account WHERE Active = true")',
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
        params.query || buildDefaultQuery('Account', params.maxResults, params.startPosition)

      // Apply pagination to custom queries
      const queryWithPagination = params.query
        ? addPaginationToQuery(rawQuery, params.maxResults, params.startPosition)
        : rawQuery

      const query = validateQuickBooksQuery(queryWithPagination, 'Account')

      const accounts = await new Promise<any[]>((resolve, reject) => {
        qbo.findAccounts(query, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result.QueryResponse?.Account || [])
        })
      })

      return {
        success: true,
        output: {
          accounts,
          metadata: {
            count: accounts.length,
            maxResults: params.maxResults || 100,
            startPosition: params.startPosition || 1,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      logger.error('Failed to list accounts', { error: errorDetails })
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_LIST_ACCOUNTS_ERROR: Failed to list accounts - ${errorDetails}`,
      }
    }
  },

  outputs: {
    accounts: {
      type: 'json',
      description: 'Array of QuickBooks account objects',
    },
    metadata: {
      type: 'json',
      description: 'Query metadata including count',
    },
  },
}
