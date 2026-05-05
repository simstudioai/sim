import { createLogger } from '@sim/logger'
import type { QuickBooksListParams, QuickBooksVendorListResponse } from '@/tools/quickbooks/types'
import { VENDOR_OUTPUT } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksListVendors')

export const quickbooksListVendorsTool: ToolConfig<
  QuickBooksListParams,
  QuickBooksVendorListResponse
> = {
  id: 'quickbooks_list_vendors',
  name: 'QuickBooks List Vendors',
  description: 'List vendors from QuickBooks Online',
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
      description: 'Maximum number of vendors to return (default 100, max 1000)',
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
      description: 'Optional WHERE clause (e.g., "Active = true")',
    },
  },

  request: {
    url: (params) => {
      const max = Math.min(Math.max(Number(params.maxResults) || 100, 1), 1000)
      const start = Math.max(Number(params.startPosition) || 1, 1)
      const whereClause = params.where ? ` WHERE ${params.where}` : ''
      const sql = `SELECT * FROM Vendor${whereClause} STARTPOSITION ${start} MAXRESULTS ${max}`
      const url = buildCompanyUrl(params.realmId, '/query')
      return `${url}?query=${encodeURIComponent(sql)}&minorversion=73`
    },
    method: 'GET',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks list vendors failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'Failed to list QuickBooks vendors')
    }
    const vendors = (data?.QueryResponse?.Vendor ?? []) as Record<string, unknown>[]
    const reportedTotal = data?.QueryResponse?.totalCount
    const totalCount = typeof reportedTotal === 'number' ? reportedTotal : vendors.length
    return {
      success: true,
      output: { vendors, totalCount },
    }
  },

  outputs: {
    vendors: {
      type: 'array',
      description: 'Array of vendors',
      items: { type: 'object', properties: VENDOR_OUTPUT },
    },
    totalCount: { type: 'number', description: 'Number of vendors returned' },
  },
}
