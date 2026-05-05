import { createLogger } from '@sim/logger'
import type { QuickBooksQueryParams, QuickBooksQueryResponse } from '@/tools/quickbooks/types'
import { buildCompanyUrl, quickbooksAuthHeaders } from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('QuickBooksQuery')

export const quickbooksQueryTool: ToolConfig<QuickBooksQueryParams, QuickBooksQueryResponse> = {
  id: 'quickbooks_query',
  name: 'QuickBooks Query',
  description:
    'Run a QuickBooks Online query using SQL-like syntax (example: SELECT * FROM Item WHERE Active = true)',
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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'QuickBooks Query Language statement (e.g., "SELECT * FROM Vendor WHERE Active = true MAXRESULTS 50")',
    },
  },

  request: {
    url: (params) => {
      const url = buildCompanyUrl(params.realmId, '/query')
      return `${url}?query=${encodeURIComponent(params.query)}&minorversion=73`
    },
    method: 'GET',
    headers: (params) => quickbooksAuthHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('QuickBooks query failed', { status: response.status, data })
      throw new Error(data?.Fault?.Error?.[0]?.Message || 'QuickBooks query failed')
    }
    const queryResponse = (data?.QueryResponse ?? {}) as Record<string, unknown>
    const reportedTotal = queryResponse.totalCount
    const totalCount =
      typeof reportedTotal === 'number'
        ? reportedTotal
        : Object.values(queryResponse).reduce<number>(
            (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
            0
          )
    return {
      success: true,
      output: {
        results: queryResponse,
        totalCount,
      },
    }
  },

  outputs: {
    results: { type: 'json', description: 'Raw QueryResponse object from QuickBooks' },
    totalCount: { type: 'number', description: 'Reported total count' },
  },
}
