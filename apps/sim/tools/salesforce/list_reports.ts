import { createLogger } from '@sim/logger'
import type {
  SalesforceListReportsParams,
  SalesforceListReportsResponse,
} from '@/tools/salesforce/types'
import { LIST_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceReports')

/**
 * List all reports accessible by the current user
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_get_reportlist.htm
 */
export const salesforceListReportsTool: ToolConfig<
  SalesforceListReportsParams,
  SalesforceListReportsResponse
> = {
  id: 'salesforce_list_reports',
  name: 'List Reports from Salesforce',
  description: 'Get a list of reports accessible by the current user',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    folderName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter reports by folder name (case-insensitive partial match)',
    },
    searchTerm: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter reports by name or description',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/analytics/reports`
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
        'Failed to list reports from Salesforce'
      )
      logger.error('Failed to list reports', { data, status: response.status })
      throw new Error(errorMessage)
    }

    let reports = data || []

    // Filter by folder name if provided
    if (params?.folderName) {
      reports = reports.filter((report: any) =>
        report.folderName?.toLowerCase().includes(params.folderName!.toLowerCase())
      )
    }

    // Filter by search term if provided
    if (params?.searchTerm) {
      reports = reports.filter(
        (report: any) =>
          report.name?.toLowerCase().includes(params.searchTerm!.toLowerCase()) ||
          report.description?.toLowerCase().includes(params.searchTerm!.toLowerCase())
      )
    }

    return {
      success: true,
      output: {
        reports,
        totalReturned: reports.length,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Reports data',
      properties: {
        reports: { type: 'array', description: 'Array of report objects' },
        ...LIST_OUTPUT_PROPERTIES,
      },
    },
  },
}
