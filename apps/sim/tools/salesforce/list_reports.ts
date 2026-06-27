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
 * List up to 200 of the current user's most recently viewed reports.
 * The Report List resource returns recently viewed reports, not the org's full
 * report catalog — use a SOQL query against the Report object for that.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_get_reportlist.htm
 */
export const salesforceListReportsTool: ToolConfig<
  SalesforceListReportsParams,
  SalesforceListReportsResponse
> = {
  id: 'salesforce_list_reports',
  name: 'List Reports from Salesforce',
  description: 'Get a list of up to 200 recently viewed reports for the current user',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    searchTerm: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter reports by name (case-insensitive partial match)',
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

    // GET /analytics/reports returns a bare top-level array of report objects,
    // each with name, id, url, describeUrl, and instancesUrl.
    let reports = Array.isArray(data) ? data : []

    // The list resource only returns the report name (no folder/description),
    // so searchTerm can only match against the report name.
    if (params?.searchTerm) {
      reports = reports.filter((report: any) =>
        report.name?.toLowerCase().includes(params.searchTerm!.toLowerCase())
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
