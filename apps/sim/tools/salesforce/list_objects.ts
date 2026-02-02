import { createLogger } from '@sim/logger'
import type {
  SalesforceListObjectsParams,
  SalesforceListObjectsResponse,
} from '@/tools/salesforce/types'
import { LIST_OBJECTS_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceQuery')

/**
 * List all available Salesforce objects
 * Useful for discovering what objects are available
 */
export const salesforceListObjectsTool: ToolConfig<
  SalesforceListObjectsParams,
  SalesforceListObjectsResponse
> = {
  id: 'salesforce_list_objects',
  name: 'List Salesforce Objects',
  description: 'Get a list of all available Salesforce objects',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/sobjects`
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
        'Failed to list Salesforce objects'
      )
      logger.error('Failed to list objects', { data, status: response.status })
      throw new Error(errorMessage)
    }

    const objects = data.sobjects || []

    return {
      success: true,
      output: {
        objects,
        encoding: data.encoding ?? null,
        maxBatchSize: data.maxBatchSize ?? null,
        totalReturned: objects.length,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Objects list',
      properties: LIST_OBJECTS_OUTPUT_PROPERTIES,
    },
  },
}
