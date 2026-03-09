import { createLogger } from '@sim/logger'
import type {
  SalesforceListReportTypesParams,
  SalesforceListReportTypesResponse,
} from '@/tools/salesforce/types'
import { LIST_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceReports')

/**
 * Get list of available report types
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_list_reporttypes.htm
 */
export const salesforceListReportTypesTool: ToolConfig<
  SalesforceListReportTypesParams,
  SalesforceListReportTypesResponse
> = {
  id: 'salesforce_list_report_types',
  name: 'List Report Types from Salesforce',
  description: 'Get a list of available report types',
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
      return `${instanceUrl}/services/data/v59.0/analytics/reportTypes`
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
        'Failed to list report types from Salesforce'
      )
      logger.error('Failed to list report types', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        reportTypes: data,
        totalReturned: Array.isArray(data) ? data.length : 0,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Report types data',
      properties: {
        reportTypes: { type: 'array', description: 'Array of report type objects' },
        ...LIST_OUTPUT_PROPERTIES,
      },
    },
  },
}
