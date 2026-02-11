import { createLogger } from '@sim/logger'
import type {
  SalesforceRefreshDashboardParams,
  SalesforceRefreshDashboardResponse,
} from '@/tools/salesforce/types'
import { REFRESH_DASHBOARD_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceDashboards')

/**
 * Refresh a dashboard to get latest data
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_refresh_dashboard.htm
 */
export const salesforceRefreshDashboardTool: ToolConfig<
  SalesforceRefreshDashboardParams,
  SalesforceRefreshDashboardResponse
> = {
  id: 'salesforce_refresh_dashboard',
  name: 'Refresh Dashboard in Salesforce',
  description: 'Refresh a dashboard to get the latest data',
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
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },

  transformResponse: async (response, params?) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        `Failed to refresh dashboard ID: ${params?.dashboardId}`
      )
      logger.error('Failed to refresh dashboard', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        dashboard: data,
        dashboardId: params?.dashboardId || '',
        components: data.componentData || [],
        status: data.status ?? null,
        dashboardName: data.name ?? null,
        refreshDate: data.refreshDate ?? null,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Refreshed dashboard data',
      properties: REFRESH_DASHBOARD_OUTPUT_PROPERTIES,
    },
  },
}
