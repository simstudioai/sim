import { createLogger } from '@sim/logger'
import type { QuickBooksAccountListResponse, QuickBooksListParams } from '@/tools/quickbooks/types'
import { ACCOUNT_OUTPUT } from '@/tools/quickbooks/types'
import {
  buildCompanyUrl,
  quickbooksAuthHeaders,
  sanitizeWhereClause,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksListAccounts')

export const quickbooksListAccountsTool: ToolConfig<
  QuickBooksListParams,
  QuickBooksAccountListResponse
> = {
  id: 'quickbooks_list_accounts',
  name: 'QuickBooks List Accounts',
  description: 'List chart-of-accounts entries from QuickBooks Online',
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
      description: 'Maximum number of accounts to return (default 100, max 1000)',
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
      description: 'Optional WHERE clause (e.g., "AccountType = \'Income\'")',
    },
  },

  request: {
    url: (params) => {
      const max = Math.min(Math.max(Number(params.maxResults) || 100, 1), 1000)
      const start = Math.max(Number(params.startPosition) || 1, 1)
      const safeWhere = sanitizeWhereClause(params.where)
      const whereClause = safeWhere ? ` WHERE ${safeWhere}` : ''
      const sql = `SELECT * FROM Account${whereClause} STARTPOSITION ${start} MAXRESULTS ${max}`
      const url = buildCompanyUrl(params.realmId, '/query')
      return `${url}?query=${encodeURIComponent(sql)}&minorversion=73`
    },
    method: 'GET',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks list accounts failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to list QuickBooks accounts')
    }
    const accounts = (data?.QueryResponse?.Account ?? []) as Record<string, unknown>[]
    const reportedTotal = data?.QueryResponse?.totalCount
    const totalCount = typeof reportedTotal === 'number' ? reportedTotal : accounts.length
    return {
      success: true,
      output: { accounts, totalCount },
    }
  },

  outputs: {
    accounts: {
      type: 'array',
      description: 'Array of accounts',
      items: { type: 'object', properties: ACCOUNT_OUTPUT },
    },
    totalCount: { type: 'number', description: 'Number of accounts returned' },
  },
}
