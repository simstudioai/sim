import { createLogger } from '@sim/logger'
import type {
  SalesforceGetReportParams,
  SalesforceGetReportResponse,
} from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceReports')

/**
 * Get metadata for a specific report
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_get_reportmetadata.htm
 */
export const salesforceGetReportTool: ToolConfig<
  SalesforceGetReportParams,
  SalesforceGetReportResponse
> = {
  id: 'salesforce_get_report',
  name: 'Get Report Metadata from Salesforce',
  description: 'Get metadata and describe information for a specific report',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Report ID (required)',
    },
  },

  request: {
    url: (params) => {
      if (!params.reportId || params.reportId.trim() === '') {
        throw new Error('Report ID is required. Please provide a valid Salesforce Report ID.')
      }
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/analytics/reports/${params.reportId}/describe`
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
        `Failed to get report metadata for report ID: ${params?.reportId}`
      )
      logger.error('Failed to get report metadata', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        report: data,
        reportId: params?.reportId || '',
        metadata: {
          operation: 'get_report',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Report metadata',
      properties: {
        report: { type: 'object', description: 'Report metadata object' },
        reportId: { type: 'string', description: 'Report ID' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
