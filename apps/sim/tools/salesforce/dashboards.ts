import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceDashboards')

/**
 * Extracts Salesforce instance URL from ID token or uses provided instance URL
 */
function getInstanceUrl(idToken?: string, instanceUrl?: string): string {
  if (instanceUrl) return instanceUrl
  if (idToken) {
    try {
      const base64Url = idToken.split('.')[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
          .join('')
      )
      const decoded = JSON.parse(jsonPayload)
      if (decoded.profile) {
        const match = decoded.profile.match(/^(https:\/\/[^/]+)/)
        if (match) return match[1]
      } else if (decoded.sub) {
        const match = decoded.sub.match(/^(https:\/\/[^/]+)/)
        if (match && match[1] !== 'https://login.salesforce.com') return match[1]
      }
    } catch (error) {
      logger.error('Failed to decode Salesforce idToken', { error })
    }
  }
  throw new Error('Salesforce instance URL is required but not provided')
}

/**
 * Extracts a descriptive error message from Salesforce API responses
 */
function extractErrorMessage(data: any, status: number, defaultMessage: string): string {
  if (Array.isArray(data) && data[0]?.message) {
    return `Salesforce API Error (${status}): ${data[0].message}${data[0].errorCode ? ` [${data[0].errorCode}]` : ''}`
  }
  if (data?.message) {
    return `Salesforce API Error (${status}): ${data.message}`
  }
  if (data?.error) {
    return `Salesforce API Error (${status}): ${data.error}${data.error_description ? ` - ${data.error_description}` : ''}`
  }
  switch (status) {
    case 400:
      return `Salesforce API Error (400): Bad Request - The request was malformed or missing required parameters`
    case 401:
      return `Salesforce API Error (401): Unauthorized - Invalid or expired access token. Please re-authenticate.`
    case 403:
      return `Salesforce API Error (403): Forbidden - You do not have permission to access this resource. Check that your user has the required permissions for Dashboards.`
    case 404:
      return `Salesforce API Error (404): Not Found - The requested dashboard does not exist or you do not have access to it.`
    case 500:
      return `Salesforce API Error (500): Internal Server Error - An error occurred on Salesforce's servers.`
    default:
      return `${defaultMessage} (HTTP ${status})`
  }
}

export interface SalesforceListDashboardsParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  folderName?: string
}

/**
 * List all dashboards accessible by the current user
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_getbasic_dashboardlist.htm
 */
export const salesforceListDashboardsTool: ToolConfig<any, any> = {
  id: 'salesforce_list_dashboards',
  name: 'List Dashboards from Salesforce',
  description: 'Get a list of dashboards accessible by the current user',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    folderName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by folder name',
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
  transformResponse: async (response, params) => {
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
    if (params.folderName) {
      dashboards = dashboards.filter((dashboard: any) =>
        dashboard.folderName?.toLowerCase().includes(params.folderName.toLowerCase())
      )
    }

    return {
      success: true,
      output: {
        dashboards,
        metadata: {
          operation: 'list_dashboards',
          totalReturned: dashboards.length,
        },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Dashboards data',
      properties: {
        dashboards: { type: 'array', description: 'Array of dashboard objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}

export interface SalesforceGetDashboardParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  dashboardId: string
}

/**
 * Get details for a specific dashboard
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_dashboard_results.htm
 */
export const salesforceGetDashboardTool: ToolConfig<any, any> = {
  id: 'salesforce_get_dashboard',
  name: 'Get Dashboard from Salesforce',
  description: 'Get details and results for a specific dashboard',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    dashboardId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dashboard ID (required)',
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
  transformResponse: async (response, params) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        `Failed to get dashboard ID: ${params.dashboardId}`
      )
      logger.error('Failed to get dashboard', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        dashboard: data,
        dashboardId: params.dashboardId,
        components: data.componentData || [],
        metadata: {
          operation: 'get_dashboard',
          dashboardName: data.name,
          folderId: data.folderId,
          runningUser: data.runningUser,
        },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Dashboard data',
      properties: {
        dashboard: { type: 'object', description: 'Dashboard details' },
        dashboardId: { type: 'string', description: 'Dashboard ID' },
        components: { type: 'array', description: 'Dashboard component data' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}

/**
 * Refresh a dashboard to get latest data
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_refresh_dashboard.htm
 */
export const salesforceRefreshDashboardTool: ToolConfig<any, any> = {
  id: 'salesforce_refresh_dashboard',
  name: 'Refresh Dashboard in Salesforce',
  description: 'Refresh a dashboard to get the latest data',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    dashboardId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dashboard ID (required)',
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
  transformResponse: async (response, params) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        `Failed to refresh dashboard ID: ${params.dashboardId}`
      )
      logger.error('Failed to refresh dashboard', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        dashboard: data,
        dashboardId: params.dashboardId,
        components: data.componentData || [],
        status: data.status,
        metadata: {
          operation: 'refresh_dashboard',
          dashboardName: data.name,
          refreshDate: data.refreshDate,
        },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Refreshed dashboard data',
      properties: {
        dashboard: { type: 'object', description: 'Dashboard details' },
        dashboardId: { type: 'string', description: 'Dashboard ID' },
        components: { type: 'array', description: 'Dashboard component data' },
        status: { type: 'object', description: 'Dashboard status' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
