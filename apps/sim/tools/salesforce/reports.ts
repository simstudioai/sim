import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceReports')

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
  // Salesforce returns errors in various formats
  if (Array.isArray(data) && data[0]?.message) {
    return `Salesforce API Error (${status}): ${data[0].message}${data[0].errorCode ? ` [${data[0].errorCode}]` : ''}`
  }
  if (data?.message) {
    return `Salesforce API Error (${status}): ${data.message}`
  }
  if (data?.error) {
    return `Salesforce API Error (${status}): ${data.error}${data.error_description ? ` - ${data.error_description}` : ''}`
  }
  // Common HTTP status code messages
  switch (status) {
    case 400:
      return `Salesforce API Error (400): Bad Request - The request was malformed or missing required parameters`
    case 401:
      return `Salesforce API Error (401): Unauthorized - Invalid or expired access token. Please re-authenticate.`
    case 403:
      return `Salesforce API Error (403): Forbidden - You do not have permission to access this resource. Check that your user has the required permissions for Reports & Dashboards.`
    case 404:
      return `Salesforce API Error (404): Not Found - The requested resource does not exist or you do not have access to it.`
    case 500:
      return `Salesforce API Error (500): Internal Server Error - An error occurred on Salesforce's servers.`
    default:
      return `${defaultMessage} (HTTP ${status})`
  }
}

export interface SalesforceListReportsParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  folderName?: string
  searchTerm?: string
}

/**
 * List all reports accessible by the current user
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_get_reportlist.htm
 */
export const salesforceListReportsTool: ToolConfig<any, any> = {
  id: 'salesforce_list_reports',
  name: 'List Reports from Salesforce',
  description: 'Get a list of reports accessible by the current user',
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
    searchTerm: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Search term to filter reports by name',
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
  transformResponse: async (response, params) => {
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
    if (params.folderName) {
      reports = reports.filter((report: any) =>
        report.folderName?.toLowerCase().includes(params.folderName.toLowerCase())
      )
    }

    // Filter by search term if provided
    if (params.searchTerm) {
      reports = reports.filter(
        (report: any) =>
          report.name?.toLowerCase().includes(params.searchTerm.toLowerCase()) ||
          report.description?.toLowerCase().includes(params.searchTerm?.toLowerCase())
      )
    }

    return {
      success: true,
      output: {
        reports,
        metadata: {
          operation: 'list_reports',
          totalReturned: reports.length,
        },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Reports data',
      properties: {
        reports: { type: 'array', description: 'Array of report objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}

export interface SalesforceGetReportParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  reportId: string
}

/**
 * Get metadata for a specific report
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_get_reportmetadata.htm
 */
export const salesforceGetReportTool: ToolConfig<any, any> = {
  id: 'salesforce_get_report',
  name: 'Get Report Metadata from Salesforce',
  description: 'Get metadata and describe information for a specific report',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
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
  transformResponse: async (response, params) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        `Failed to get report metadata for report ID: ${params.reportId}`
      )
      logger.error('Failed to get report metadata', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        report: data,
        reportId: params.reportId,
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

export interface SalesforceRunReportParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  reportId: string
  includeDetails?: string
  filters?: string
}

/**
 * Run a report and return the results
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_get_reportdata.htm
 */
export const salesforceRunReportTool: ToolConfig<any, any> = {
  id: 'salesforce_run_report',
  name: 'Run Report in Salesforce',
  description: 'Execute a report and retrieve the results',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
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
    includeDetails: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Include detail rows (true/false, default: true)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'JSON string of report filters to apply',
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
  transformResponse: async (response, params) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = extractErrorMessage(
        data,
        response.status,
        `Failed to run report ID: ${params.reportId}`
      )
      logger.error('Failed to run report', { data, status: response.status })
      throw new Error(errorMessage)
    }

    return {
      success: true,
      output: {
        reportId: params.reportId,
        reportMetadata: data.reportMetadata,
        reportExtendedMetadata: data.reportExtendedMetadata,
        factMap: data.factMap,
        groupingsDown: data.groupingsDown,
        groupingsAcross: data.groupingsAcross,
        hasDetailRows: data.hasDetailRows,
        allData: data.allData,
        metadata: {
          operation: 'run_report',
          reportName: data.reportMetadata?.name,
          reportFormat: data.reportMetadata?.reportFormat,
        },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Report results',
      properties: {
        reportId: { type: 'string', description: 'Report ID' },
        reportMetadata: { type: 'object', description: 'Report metadata' },
        reportExtendedMetadata: { type: 'object', description: 'Extended metadata' },
        factMap: { type: 'object', description: 'Report data organized by groupings' },
        groupingsDown: { type: 'object', description: 'Row groupings' },
        groupingsAcross: { type: 'object', description: 'Column groupings' },
        hasDetailRows: { type: 'boolean', description: 'Whether report has detail rows' },
        allData: { type: 'boolean', description: 'Whether all data is returned' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}

/**
 * Get list of available report types
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_list_reporttypes.htm
 */
export const salesforceListReportTypesTool: ToolConfig<any, any> = {
  id: 'salesforce_list_report_types',
  name: 'List Report Types from Salesforce',
  description: 'Get a list of available report types',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
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
        metadata: {
          operation: 'list_report_types',
          totalReturned: Array.isArray(data) ? data.length : 0,
        },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: {
      type: 'object',
      description: 'Report types data',
      properties: {
        reportTypes: { type: 'array', description: 'Array of report type objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
