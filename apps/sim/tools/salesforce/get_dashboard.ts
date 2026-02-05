import { createLogger } from '@sim/logger'
import type {
  SalesforceGetDashboardParams,
  SalesforceGetDashboardResponse,
} from '@/tools/salesforce/types'
import { DASHBOARD_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceDashboards')

/**
 * Get details for a specific dashboard
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_dashboard_results.htm
 */
export const salesforceGetDashboardTool: ToolConfig<
  SalesforceGetDashboardParams,
  SalesforceGetDashboardResponse
> = {
  id: 'salesforce_get_dashboard',
  name: 'Get Dashboard from Salesforce',
  description: 'Get details and results for a specific dashboard',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    dashboardId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Salesforce Dashboard ID (18-character string starting with 01Z)',
    },
  },

  request: {
    url: (params) => {
      if (!params.dashboardId || params.dashboardId.trim() === '') {
        throw new Error('Dashboard ID is required. Please provide a valid Salesforce Dashboard ID.')
      }
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/analytics/dashboards/${params.dashboardId}`
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
        `Failed to get dashboard ID: ${params?.dashboardId}`
      )
      logger.error('Failed to get dashboard', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        dashboard: data,
        dashboardId: params?.dashboardId || '',
        components: data.componentData || [],
        dashboardName: data.name ?? null,
        folderId: data.folderId ?? null,
        runningUser: data.runningUser ?? null,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Dashboard data',
      properties: DASHBOARD_OUTPUT_PROPERTIES,
    },
  },
}
