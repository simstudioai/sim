import { createLogger } from '@sim/logger'
import type {
  SalesforceListDashboardsParams,
  SalesforceListDashboardsResponse,
} from '@/tools/salesforce/types'
import { LIST_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceDashboards')

/**
 * List all dashboards accessible by the current user
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_getbasic_dashboardlist.htm
 */
export const salesforceListDashboardsTool: ToolConfig<
  SalesforceListDashboardsParams,
  SalesforceListDashboardsResponse
> = {
  id: 'salesforce_list_dashboards',
  name: 'List Dashboards from Salesforce',
  description: 'Get a list of dashboards accessible by the current user',
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
      description: 'Filter dashboards by folder name (case-insensitive partial match)',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      return `${instanceUrl}/services/data/v59.0/analytics/dashboards`
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
        'Failed to list dashboards from Salesforce'
      )
      logger.error('Failed to list dashboards', { data, status: response.status })
      throw new Error(errorMessage)
    }

    let dashboards = data.dashboards || data || []

    // Filter by folder name if provided
    if (params?.folderName) {
      dashboards = dashboards.filter((dashboard: any) =>
        dashboard.folderName?.toLowerCase().includes(params.folderName!.toLowerCase())
      )
    }

    return {
      success: true,
      output: {
        dashboards,
        totalReturned: dashboards.length,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Dashboards data',
      properties: {
        dashboards: { type: 'array', description: 'Array of dashboard objects' },
        ...LIST_OUTPUT_PROPERTIES,
      },
    },
  },
}
