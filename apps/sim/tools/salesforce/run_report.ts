import { createLogger } from '@sim/logger'
import type {
  SalesforceRunReportParams,
  SalesforceRunReportResponse,
} from '@/tools/salesforce/types'
import { RUN_REPORT_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceReports')

/**
 * Run a report and return the results
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_get_reportdata.htm
 */
export const salesforceRunReportTool: ToolConfig<
  SalesforceRunReportParams,
  SalesforceRunReportResponse
> = {
  id: 'salesforce_run_report',
  name: 'Run Report in Salesforce',
  description: 'Execute a report and retrieve the results',
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
      visibility: 'user-or-llm',
      description: 'Salesforce Report ID (18-character string starting with 00O)',
    },
    includeDetails: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include detail rows (true/false, default: true)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of report filter objects to apply',
    },
  },

  request: {
    url: (params) => {
      if (!params.reportId || params.reportId.trim() === '') {
        throw new Error('Report ID is required. Please provide a valid Salesforce Report ID.')
      }
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      const includeDetails = params.includeDetails !== 'false'
      return `${instanceUrl}/services/data/v59.0/analytics/reports/${params.reportId}?includeDetails=${includeDetails}`
    },
    // Use GET for simple report runs, POST only when filters are provided
    method: (params) => (params.filters ? 'POST' : 'GET'),
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // Only send a body when filters are provided (POST request)
      if (params.filters) {
        try {
          const filters = JSON.parse(params.filters)
          return { reportMetadata: { reportFilters: filters } }
        } catch (e) {
          throw new Error(
            `Invalid report filters JSON: ${e instanceof Error ? e.message : 'Parse error'}. Please provide a valid JSON array of filter objects.`
          )
        }
      }
      // Return undefined for GET requests (no body)
      return undefined as any
    },
  },

  transformResponse: async (response, params?) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        `Failed to run report ID: ${params?.reportId}`
      )
      logger.error('Failed to run report', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        reportId: params?.reportId || '',
        reportMetadata: data.reportMetadata ?? null,
        reportExtendedMetadata: data.reportExtendedMetadata ?? null,
        factMap: data.factMap ?? null,
        groupingsDown: data.groupingsDown ?? null,
        groupingsAcross: data.groupingsAcross ?? null,
        hasDetailRows: data.hasDetailRows ?? null,
        allData: data.allData ?? null,
        reportName: data.reportMetadata?.name ?? null,
        reportFormat: data.reportMetadata?.reportFormat ?? null,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Report results',
      properties: RUN_REPORT_OUTPUT_PROPERTIES,
    },
  },
}
