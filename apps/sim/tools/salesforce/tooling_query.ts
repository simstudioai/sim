import { createLogger } from '@sim/logger'
import type {
  SalesforceToolingQueryParams,
  SalesforceToolingQueryResponse,
} from '@/tools/salesforce/types'
import { TOOLING_QUERY_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceToolingQuery')

/**
 * Execute a SOQL query against the Tooling API. Use this to inspect metadata
 * objects such as CustomField and CustomObject — for example to find a field's
 * Id before updating or deleting it:
 * `SELECT Id, DeveloperName FROM CustomField WHERE TableEnumOrId = 'Account'`.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/intro_rest_resources.htm
 */
export const salesforceToolingQueryTool: ToolConfig<
  SalesforceToolingQueryParams,
  SalesforceToolingQueryResponse
> = {
  id: 'salesforce_tooling_query',
  name: 'Run Tooling SOQL Query in Salesforce',
  description: 'Execute a SOQL query against the Tooling API to inspect metadata objects',
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
      description:
        "Tooling SOQL query (e.g., SELECT Id, DeveloperName FROM CustomField WHERE TableEnumOrId = 'Account')",
    },
  },

  request: {
    url: (params) => {
      if (!params.query || params.query.trim() === '') {
        throw new Error(
          "Tooling SOQL Query is required (e.g., SELECT Id, DeveloperName FROM CustomField WHERE TableEnumOrId = 'Account')."
        )
      }
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      const encodedQuery = encodeURIComponent(params.query)
      return `${instanceUrl}/services/data/v59.0/tooling/query?q=${encodedQuery}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        'Failed to execute Tooling SOQL query'
      )
      logger.error('Failed to execute Tooling SOQL query', { data, status: response.status })
      throw new Error(errorMessage)
    }

    const records = data.records || []
    const done = data.done !== false

    return {
      success: true,
      output: {
        records,
        totalSize: data.totalSize ?? records.length,
        done,
        nextRecordsUrl: data.nextRecordsUrl ?? null,
        query: params?.query || '',
        metadata: {
          totalReturned: records.length,
          hasMore: !done,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Tooling query results',
      properties: TOOLING_QUERY_OUTPUT_PROPERTIES,
    },
  },
}
