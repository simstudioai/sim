import { createLogger } from '@sim/logger'
import type { QuickBooksCustomerListResponse, QuickBooksListParams } from '@/tools/quickbooks/types'
import { CUSTOMER_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksListCustomers')

export const quickbooksListCustomersTool: ToolConfig<
  QuickBooksListParams,
  QuickBooksCustomerListResponse
> = {
  id: 'quickbooks_list_customers',
  name: 'QuickBooks List Customers',
  description: 'List customers from QuickBooks Online',
  version: '1.0.0',

  oauth: { required: true, provider: 'quickbooks' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks company ID (realmId) — captured at OAuth time',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of customers to return (default 100, max 1000)',
    },
    startPosition: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination start position (1-indexed)',
    },
    where: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional WHERE clause (e.g., "Active = true AND DisplayName LIKE \'A%\'")',
    },
  },

  request: {
    url: (params) => {
      const max = Math.min(Math.max(Number(params.maxResults) || 100, 1), 1000)
      const start = Math.max(Number(params.startPosition) || 1, 1)
      const whereClause = params.where ? ` WHERE ${params.where}` : ''
      const sql = `SELECT * FROM Customer${whereClause} STARTPOSITION ${start} MAXRESULTS ${max}`
      const url = buildCompanyUrl(params.realmId, '/query')
      return `${url}?query=${encodeURIComponent(sql)}&minorversion=73`
    },
    method: 'GET',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks list customers failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to list QuickBooks customers')
    }
    const customers = (data?.QueryResponse?.Customer ?? []) as Record<string, unknown>[]
    const reportedTotal = data?.QueryResponse?.totalCount
    const totalCount = typeof reportedTotal === 'number' ? reportedTotal : customers.length
    return {
      success: true,
      output: {
        customers,
        totalCount,
      },
    }
  },

  outputs: {
    customers: {
      type: 'array',
      description: 'Array of QuickBooks customers',
      items: { type: 'object', properties: CUSTOMER_OUTPUT },
    },
    totalCount: { type: 'number', description: 'Number of customers returned' },
  },
}
