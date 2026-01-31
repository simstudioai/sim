import { createLogger } from '@sim/logger'
import type { SalesforceQueryParams, SalesforceQueryResponse } from '@/tools/salesforce/types'
import { QUERY_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceQuery')

/**
 * Execute a custom SOQL query
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm
 */
export const salesforceQueryTool: ToolConfig<SalesforceQueryParams, SalesforceQueryResponse> = {
  id: 'salesforce_query',
  name: 'Run SOQL Query in Salesforce',
  description: 'Execute a custom SOQL query to retrieve data from Salesforce',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SOQL query to execute (e.g., SELECT Id, Name FROM Account LIMIT 10)',
    },
  },

  request: {
    url: (params) => {
      if (!params.query || params.query.trim() === '') {
        throw new Error(
          'SOQL Query is required. Please provide a valid SOQL query (e.g., SELECT Id, Name FROM Account LIMIT 10).'
        )
      }
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      const encodedQuery = encodeURIComponent(params.query)
      return `${instanceUrl}/services/data/v59.0/query?q=${encodedQuery}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params?) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        'Failed to execute SOQL query'
      )
      logger.error('Failed to execute SOQL query', { data, status: response.status })
      throw new Error(errorMessage)
    }

    const records = data.records || []

    return {
      success: true,
      output: {
        records,
        totalSize: data.totalSize || records.length,
        done: data.done !== false,
        nextRecordsUrl: data.nextRecordsUrl ?? null,
        query: params?.query || '',
        metadata: {
          totalReturned: records.length,
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
      description: 'Query results',
      properties: QUERY_OUTPUT_PROPERTIES,
    },
  },
}
