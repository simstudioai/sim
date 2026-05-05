import { createLogger } from '@sim/logger'
import type { QuickBooksListParams, QuickBooksPaymentListResponse } from '@/tools/quickbooks/types'
import { PAYMENT_OUTPUT } from '@/tools/quickbooks/types'
import {
  buildCompanyUrl,
  quickbooksAuthHeaders,
  sanitizeWhereClause,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksListPayments')

export const quickbooksListPaymentsTool: ToolConfig<
  QuickBooksListParams,
  QuickBooksPaymentListResponse
> = {
  id: 'quickbooks_list_payments',
  name: 'QuickBooks List Payments',
  description: 'List payments from QuickBooks Online',
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
      description: 'Maximum number of payments to return (default 100, max 1000)',
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
      description: 'Optional WHERE clause',
    },
  },

  request: {
    url: (params) => {
      const max = Math.min(Math.max(Number(params.maxResults) || 100, 1), 1000)
      const start = Math.max(Number(params.startPosition) || 1, 1)
      const safeWhere = sanitizeWhereClause(params.where)
      const whereClause = safeWhere ? ` WHERE ${safeWhere}` : ''
      const sql = `SELECT * FROM Payment${whereClause} STARTPOSITION ${start} MAXRESULTS ${max}`
      const url = buildCompanyUrl(params.realmId, '/query')
      return `${url}?query=${encodeURIComponent(sql)}&minorversion=73`
    },
    method: 'GET',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks list payments failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to list QuickBooks payments')
    }
    const payments = (data?.QueryResponse?.Payment ?? []) as Record<string, unknown>[]
    const reportedTotal = data?.QueryResponse?.totalCount
    const totalCount = typeof reportedTotal === 'number' ? reportedTotal : payments.length
    return {
      success: true,
      output: { payments, totalCount },
    }
  },

  outputs: {
    payments: {
      type: 'array',
      description: 'Array of payments',
      items: { type: 'object', properties: PAYMENT_OUTPUT },
    },
    totalCount: { type: 'number', description: 'Number of payments returned' },
  },
}
