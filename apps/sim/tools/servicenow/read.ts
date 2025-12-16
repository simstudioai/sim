import { createLogger } from '@/lib/logs/console/logger'
import type { ServiceNowReadParams, ServiceNowReadResponse } from '@/tools/servicenow/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowReadTool')

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

export const readTool: ToolConfig<ServiceNowReadParams, ServiceNowReadResponse> = {
  id: 'servicenow_read',
  name: 'Read ServiceNow Records',
  description: 'Read records from a ServiceNow table',
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
      required: false,
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
      description: 'ServiceNow username (for Basic Auth)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ServiceNow password (for Basic Auth)',
    },
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name',
    },
    sysId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific record sys_id',
    },
    number: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Record number (e.g., INC0010001)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Encoded query string (e.g., "active=true^priority=1")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of records to return',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of fields to return',
    },
  },

  request: {
    url: (params) => {
      // Use instanceUrl if provided, otherwise fall back to idToken (stored instance URL from OAuth)
      const baseUrl = (params.instanceUrl || params.idToken || '').replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('ServiceNow instance URL is required')
      }
      let url = `${baseUrl}/api/now/table/${params.tableName}`

      const queryParams = new URLSearchParams()

      if (params.sysId) {
        url = `${url}/${params.sysId}`
      } else if (params.number) {
        queryParams.append('number', params.number)
      }

      if (params.query) {
        queryParams.append('sysparm_query', params.query)
      }

      if (params.limit) {
        queryParams.append('sysparm_limit', params.limit.toString())
      }

      if (params.fields) {
        queryParams.append('sysparm_fields', params.fields)
      }

      const queryString = queryParams.toString()
      return queryString ? `${url}?${queryString}` : url
    },
    method: 'GET',
    headers: (params) => {
      // Support both OAuth and Basic Auth
      if (params.accessToken) {
        return {
          Authorization: `Bearer ${params.accessToken}`,
          Accept: 'application/json',
        }
      }
      // Fall back to Basic Auth
      if (!params.username || !params.password) {
        throw new Error('Either OAuth credential or username/password is required')
      }
      const credentials = encodeBasicAuth(params.username, params.password)
      return {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        const error = data.error || data
        throw new Error(
          typeof error === 'string' ? error : error.message || JSON.stringify(error)
        )
      }

      const records = Array.isArray(data.result) ? data.result : [data.result]

      return {
        success: true,
        output: {
          records,
          metadata: {
            recordCount: records.length,
          },
        },
      }
    } catch (error) {
      logger.error('ServiceNow read - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    records: {
      type: 'array',
      description: 'Array of ServiceNow records',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
    },
  },
}

