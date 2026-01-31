import { createLogger } from '@sim/logger'
import type {
  SalesforceQueryMoreParams,
  SalesforceQueryMoreResponse,
} from '@/tools/salesforce/types'
import { QUERY_MORE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceQuery')

/**
 * Retrieve additional query results using the nextRecordsUrl
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm
 */
export const salesforceQueryMoreTool: ToolConfig<
  SalesforceQueryMoreParams,
  SalesforceQueryMoreResponse
> = {
  id: 'salesforce_query_more',
  name: 'Get More Query Results from Salesforce',
  description: 'Retrieve additional query results using the nextRecordsUrl from a previous query',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    nextRecordsUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The nextRecordsUrl value from a previous query response (e.g., /services/data/v59.0/query/01g...)',
    },
  },

  request: {
    url: (params) => {
      if (!params.nextRecordsUrl || params.nextRecordsUrl.trim() === '') {
        throw new Error(
          'Next Records URL is required. This should be the nextRecordsUrl value from a previous query response.'
        )
      }
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      // nextRecordsUrl is typically a relative path like /services/data/v59.0/query/01g...
      const nextUrl = params.nextRecordsUrl.startsWith('/')
        ? params.nextRecordsUrl
        : `/${params.nextRecordsUrl}`
      return `${instanceUrl}${nextUrl}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        'Failed to get more query results'
      )
      logger.error('Failed to get more query results', { data, status: response.status })
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
      properties: QUERY_MORE_OUTPUT_PROPERTIES,
    },
  },
}
