import { createLogger } from '@sim/logger'
import type { QuickBooksInvoiceListResponse, QuickBooksListParams } from '@/tools/quickbooks/types'
import { INVOICE_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksListInvoices')

export const quickbooksListInvoicesTool: ToolConfig<
  QuickBooksListParams,
  QuickBooksInvoiceListResponse
> = {
  id: 'quickbooks_list_invoices',
  name: 'QuickBooks List Invoices',
  description: 'List invoices from QuickBooks Online',
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
      description: 'Maximum number of invoices to return (default 100, max 1000)',
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
      description: 'Optional WHERE clause (e.g., "Balance > \'0\'")',
    },
  },

  request: {
    url: (params) => {
      const max = Math.min(Math.max(Number(params.maxResults) || 100, 1), 1000)
      const start = Math.max(Number(params.startPosition) || 1, 1)
      const whereClause = params.where ? ` WHERE ${params.where}` : ''
      const sql = `SELECT * FROM Invoice${whereClause} STARTPOSITION ${start} MAXRESULTS ${max}`
      const url = buildCompanyUrl(params.realmId, '/query')
      return `${url}?query=${encodeURIComponent(sql)}&minorversion=73`
    },
    method: 'GET',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks list invoices failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to list QuickBooks invoices')
    }
    const invoices = (data?.QueryResponse?.Invoice ?? []) as Record<string, unknown>[]
    const reportedTotal = data?.QueryResponse?.totalCount
    const totalCount = typeof reportedTotal === 'number' ? reportedTotal : invoices.length
    return {
      success: true,
      output: { invoices, totalCount },
    }
  },

  outputs: {
    invoices: {
      type: 'array',
      description: 'Array of invoices',
      items: { type: 'object', properties: INVOICE_OUTPUT },
    },
    totalCount: { type: 'number', description: 'Number of invoices returned' },
  },
}
