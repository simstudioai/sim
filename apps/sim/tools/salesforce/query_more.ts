import { createLogger } from '@sim/logger'
import type {
  SalesforceQueryMoreParams,
  SalesforceQueryMoreResponse,
} from '@/tools/salesforce/types'
import { QUERY_MORE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPath } from '@/tools/url-path'

const logger = createLogger('SalesforceQuery')

/**
 * Every REST resource Salesforce returns as a `nextRecordsUrl` — `query`,
 * `queryAll`, and the Tooling API alike — is rooted here. Asserting the prefix
 * (rather than only rejecting dot segments) keeps an LLM-supplied cursor from
 * re-aiming the request at an unrelated resource on the org with the user's
 * access token attached.
 */
const REST_API_ROOT = 'services/data'

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
      const nextUrl = safeUrlPath(params.nextRecordsUrl.trim().replace(/^\//, ''), 'nextRecordsUrl')
      if (!nextUrl.startsWith(`${REST_API_ROOT}/`)) {
        throw new Error(
          `nextRecordsUrl must be a Salesforce REST resource path beginning with "/${REST_API_ROOT}/". ` +
            'Pass the nextRecordsUrl value returned by a previous query unchanged.'
        )
      }
      return `${instanceUrl}/${nextUrl}`
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
    const done = data.done !== false

    return {
      success: true,
      output: {
        records,
        totalSize: data.totalSize || records.length,
        done,
        nextRecordsUrl: data.nextRecordsUrl ?? null,
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
      description: 'Query results',
      properties: QUERY_MORE_OUTPUT_PROPERTIES,
    },
  },
}
