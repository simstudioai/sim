import type { SalesforceGetCasesParams, SalesforceGetCasesResponse } from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceGetCasesTool: ToolConfig<
  SalesforceGetCasesParams,
  SalesforceGetCasesResponse
> = {
  id: 'salesforce_get_cases',
  name: 'Get Cases from Salesforce',
  description: 'Get case(s) from Salesforce',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    caseId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Case ID (optional)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Max results (default: 100)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated fields',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order by field',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      if (params.caseId) {
        const fields =
          params.fields || 'Id,CaseNumber,Subject,Status,Priority,Origin,ContactId,AccountId'
        return `${instanceUrl}/services/data/v59.0/sobjects/Case/${params.caseId}?fields=${fields}`
      }
      const limit = params.limit ? Number.parseInt(params.limit) : 100
      const fields =
        params.fields || 'Id,CaseNumber,Subject,Status,Priority,Origin,ContactId,AccountId'
      const orderBy = params.orderBy || 'CreatedDate DESC'
      const query = `SELECT ${fields} FROM Case ORDER BY ${orderBy} LIMIT ${limit}`
      return `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params?) => {
    const data = await response.json()
    if (!response.ok) throw new Error(data[0]?.message || data.message || 'Failed to fetch cases')
    if (params?.caseId) {
      return {
        success: true,
        output: { case: data, metadata: { operation: 'get_cases' }, success: true },
      }
    }
    const cases = data.records || []
    return {
      success: true,
      output: {
        cases,
        paging: {
          nextRecordsUrl: data.nextRecordsUrl,
          totalSize: data.totalSize || cases.length,
          done: data.done !== false,
        },
        metadata: { operation: 'get_cases', totalReturned: cases.length, hasMore: !data.done },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Case data' },
  },
}
