import { createLogger } from '@/lib/logs/console/logger'
import type { ServiceNowUpdateParams, ServiceNowUpdateResponse } from '@/tools/servicenow/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowUpdateTool')

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

export const updateTool: ToolConfig<ServiceNowUpdateParams, ServiceNowUpdateResponse> = {
  id: 'servicenow_update',
  name: 'Update ServiceNow Record',
  description: 'Update an existing record in a ServiceNow table',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Record sys_id to update',
    },
    fields: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Fields to update (JSON object)',
    },
  },

  request: {
    url: (params) => {
      // Use instanceUrl if provided, otherwise fall back to idToken (stored instance URL from OAuth)
      const baseUrl = (params.instanceUrl || params.idToken || '').replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('ServiceNow instance URL is required')
      }
      return `${baseUrl}/api/now/table/${params.tableName}/${params.sysId}`
    },
    method: 'PATCH',
    headers: (params) => {
      // Support both OAuth and Basic Auth
      if (params.accessToken) {
        return {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
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
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }
    },
    body: (params) => {
      if (!params.fields || typeof params.fields !== 'object') {
        throw new Error('Fields must be a JSON object')
      }
      return params.fields
    },
  },

  transformResponse: async (response: Response, params?: ServiceNowUpdateParams) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        const error = data.error || data
        throw new Error(
          typeof error === 'string' ? error : error.message || JSON.stringify(error)
        )
      }

      return {
        success: true,
        output: {
          record: data.result,
          metadata: {
            recordCount: 1,
            updatedFields: params ? Object.keys(params.fields || {}) : [],
          },
        },
      }
    } catch (error) {
      logger.error('ServiceNow update - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    record: {
      type: 'json',
      description: 'Updated ServiceNow record',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
    },
  },
}

