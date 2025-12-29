import QuickBooks from 'node-quickbooks'
import type { ListCustomersParams, ListCustomersResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'
import {
  validateQuickBooksQuery,
  buildDefaultQuery,
  addPaginationToQuery,
} from '@/tools/quickbooks/utils'
import { createLogger } from '@sim/logger'

const logger = createLogger('QuickBooksListCustomers')

export const quickbooksListCustomersTool: ToolConfig<ListCustomersParams, ListCustomersResponse> =
  {
    id: 'quickbooks_list_customers',
    name: 'QuickBooks List Customers',
    description: 'List customers from QuickBooks Online with optional query',
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
          'SQL-like query (e.g., "SELECT * FROM Customer WHERE Active = true ORDERBY DisplayName")',
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
          buildDefaultQuery('Customer', params.maxResults, params.startPosition)

        // Apply pagination to custom queries
        const queryWithPagination = params.query
          ? addPaginationToQuery(rawQuery, params.maxResults, params.startPosition)
          : rawQuery

        const query = validateQuickBooksQuery(queryWithPagination, 'Customer')

        const customers = await new Promise<any[]>((resolve, reject) => {
          qbo.findCustomers(query, (err: any, result: any) => {
            if (err) reject(err)
            else resolve(result.QueryResponse?.Customer || [])
          })
        })

        return {
          success: true,
          output: {
            customers,
            metadata: {
              count: customers.length,
              startPosition: params.startPosition || 1,
              maxResults: params.maxResults || 100,
            },
          },
        }
      } catch (error: any) {
        const errorDetails = error.response?.body
          ? JSON.stringify(error.response.body)
          : error.message || 'Unknown error'
        logger.error('Failed to list customers', { error: errorDetails })
        return {
          success: false,
          output: {},
          error: `QUICKBOOKS_LIST_CUSTOMERS_ERROR: Failed to list customers - ${errorDetails}`,
        }
      }
    },

    outputs: {
      customers: {
        type: 'json',
        description: 'Array of QuickBooks customer objects',
      },
      metadata: {
        type: 'json',
        description: 'Pagination metadata',
      },
    },
  }
