import type { SalesforceGetCasesParams, SalesforceGetCasesResponse } from '@/tools/salesforce/types'
import { QUERY_PAGING_OUTPUT, RESPONSE_METADATA_OUTPUT } from '@/tools/salesforce/types'
import {
  extractErrorMessage,
  getInstanceUrl,
  requireId,
  sanitizeSoqlFieldList,
  sanitizeSoqlLimit,
  sanitizeSoqlOrderBy,
} from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/** Field list used when the caller does not supply `fields`. */
const DEFAULT_FIELDS = 'Id,CaseNumber,Subject,Status,Priority,Origin,ContactId,AccountId'

/** Sort clause used when the caller does not supply `orderBy`. */
const DEFAULT_ORDER_BY = 'CreatedDate DESC'

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
      visibility: 'user-or-llm',
      description:
        'Salesforce Case ID (18-character string starting with 500) to get a single case',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default: 100)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of field API names to return Also accepts FIELDS(STANDARD|CUSTOM|ALL) and toLabel()/FORMAT()/convertCurrency() around a single field.',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field and direction for sorting (e.g., CreatedDate DESC) Bare field API names only, optionally with ASC/DESC and NULLS FIRST/LAST; SOQL functions such as DISTANCE() are not accepted here — use the Salesforce Query tool for those.',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      if (params.caseId) {
        const caseId = requireId(params.caseId, 'Case ID')
        const fields = sanitizeSoqlFieldList(params.fields, DEFAULT_FIELDS)
        return `${instanceUrl}/services/data/v59.0/sobjects/Case/${safeUrlPathSegment(caseId, 'caseId')}?fields=${encodeURIComponent(fields)}`
      }
      const limit = sanitizeSoqlLimit(params.limit)
      const fields = sanitizeSoqlFieldList(params.fields, DEFAULT_FIELDS)
      const orderBy = sanitizeSoqlOrderBy(params.orderBy, DEFAULT_ORDER_BY)
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
    if (!response.ok)
      throw new Error(extractErrorMessage(data, response.status, 'Failed to fetch cases'))
    if (params?.caseId) {
      return {
        success: true,
        output: { case: data, success: true },
      }
    }
    const cases = data.records || []
    return {
      success: true,
      output: {
        cases,
        paging: {
          nextRecordsUrl: data.nextRecordsUrl ?? null,
          totalSize: data.totalSize || cases.length,
          done: data.done !== false,
        },
        metadata: {
          totalReturned: cases.length,
          hasMore: !data.done,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Case data',
      properties: {
        case: { type: 'object', description: 'Single case object (when caseId provided)' },
        cases: { type: 'array', description: 'Array of case objects (when listing)' },
        paging: QUERY_PAGING_OUTPUT,
        metadata: RESPONSE_METADATA_OUTPUT,
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
