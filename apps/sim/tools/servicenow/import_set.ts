import { createLogger } from '@/lib/logs/console/logger'
import type {
  ServiceNowImportSetParams,
  ServiceNowImportSetResponse,
} from '@/tools/servicenow/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowImportSetTool')

/**
 * Encode credentials to base64 for Basic Auth
 * Works in both Node.js (Buffer) and browser (btoa) environments
 */
function encodeBasicAuth(username: string, password: string): string {
  const credentials = `${username}:${password}`
  // Check for Buffer in global scope (Node.js)
  const BufferGlobal = typeof globalThis !== 'undefined' && (globalThis as any).Buffer
  if (BufferGlobal) {
    return BufferGlobal.from(credentials).toString('base64')
  }
  return btoa(credentials)
}

/**
 * Get authorization header based on auth method
 * Note: For OAuth, executeTool automatically fetches the token and sets it as accessToken
 */
function getAuthHeader(params: ServiceNowImportSetParams & { accessToken?: string }): string {
  if (params.authMethod === 'oauth') {
    // OAuth: accessToken is set by executeTool when credential is provided
    const accessToken = params.accessToken
    if (!accessToken) {
      throw new Error('OAuth access token not found. Make sure credential is properly configured.')
    }
    return `Bearer ${accessToken}`
  }
  // Basic Auth
  if (!params.username || !params.password) {
    throw new Error('Username and password are required for Basic Auth')
  }
  const credentials = encodeBasicAuth(params.username, params.password)
  return `Basic ${credentials}`
}

export const importSetTool: ToolConfig<ServiceNowImportSetParams, ServiceNowImportSetResponse> = {
  id: 'servicenow_import_set',
  name: 'ServiceNow Import Set',
  description: 'Bulk import data into ServiceNow using Import Set API',
  version: '1.0.0',

  oauth: {
    required: false,
    provider: 'servicenow',
  },

  params: {
    instanceUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ServiceNow instance URL (auto-detected from OAuth if not provided)',
    },
    authMethod: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Authentication method (oauth or basic)',
    },
    credential: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'ServiceNow OAuth credential ID',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ServiceNow username (Basic Auth)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ServiceNow password (Basic Auth)',
    },
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Import set table name (e.g., u_my_import_set) or target table name for direct import',
    },
    records: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of records to import. Each record should be a JSON object with field values.',
    },
    transformMap: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Transform map sys_id to use for data transformation (optional)',
    },
    batchSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of records to import per batch (default: all records in one batch)',
    },
    importSetId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Existing import set sys_id to add records to (optional)',
    },
  },

  request: {
    url: (params) => {
      // Use instanceUrl if provided, otherwise fall back to idToken (stored instance URL from OAuth)
      const baseUrl = (params.instanceUrl || params.idToken || '').replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('ServiceNow instance URL is required')
      }
      const url = `${baseUrl}/api/now/import/${params.tableName}`

      const queryParams = new URLSearchParams()
      if (params.transformMap) {
        queryParams.append('transform_map', params.transformMap)
      }
      if (params.importSetId) {
        queryParams.append('sysparm_import_set_id', params.importSetId)
      }

      const queryString = queryParams.toString()
      return queryString ? `${url}?${queryString}` : url
    },
    method: 'POST',
    headers: (params) => {
      const authHeader = getAuthHeader(
        params as ServiceNowImportSetParams & { accessToken?: string }
      )
      return {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }
    },
    body: (params) => {
      if (!Array.isArray(params.records) || params.records.length === 0) {
        throw new Error('Records must be a non-empty array')
      }

      // If batchSize is specified, we'll import in batches
      // For now, we'll send all records in one request
      // ServiceNow Import Set API accepts an array of records
      return {
        records: params.records,
      }
    },
  },

  transformResponse: async (response: Response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        const error = data.error || data
        throw new Error(typeof error === 'string' ? error : error.message || JSON.stringify(error))
      }

      // ServiceNow Import Set API returns import results
      const result = data.result || data
      const importSetId = result.import_set_id || result.sys_id || ''
      const records = Array.isArray(result.records) ? result.records : []
      const metadata = result.metadata || {
        totalRecords: records.length,
        inserted: 0,
        updated: 0,
        ignored: 0,
        errors: 0,
      }

      // Count statuses from records if metadata is not provided
      if (!result.metadata && records.length > 0) {
        metadata.inserted = records.filter((r: any) => r.status === 'inserted').length
        metadata.updated = records.filter((r: any) => r.status === 'updated').length
        metadata.ignored = records.filter((r: any) => r.status === 'ignored').length
        metadata.errors = records.filter((r: any) => r.status === 'error').length
      }

      return {
        success: true,
        output: {
          importSetId,
          records,
          metadata: {
            totalRecords: metadata.totalRecords || records.length,
            inserted: metadata.inserted || 0,
            updated: metadata.updated || 0,
            ignored: metadata.ignored || 0,
            errors: metadata.errors || 0,
          },
        },
      }
    } catch (error) {
      logger.error('ServiceNow import set - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    importSetId: {
      type: 'string',
      description: 'Import set sys_id that was created or used',
    },
    records: {
      type: 'array',
      description: 'Array of imported records with their status',
    },
    metadata: {
      type: 'json',
      description:
        'Import metadata including counts of inserted, updated, ignored, and error records',
    },
  },
}
