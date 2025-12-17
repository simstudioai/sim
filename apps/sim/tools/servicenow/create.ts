import { createLogger } from '@/lib/logs/console/logger'
import type { ServiceNowCreateParams, ServiceNowCreateResponse } from '@/tools/servicenow/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowCreateTool')

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
function getAuthHeader(params: ServiceNowCreateParams & { accessToken?: string }): string {
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

export const createTool: ToolConfig<ServiceNowCreateParams, ServiceNowCreateResponse> = {
  id: 'servicenow_create',
  name: 'Create ServiceNow Record',
  description: 'Create a new record in a ServiceNow table',
  version: '1.0.0',

  oauth: {
    required: false,
    provider: 'servicenow',
  },

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow instance URL (e.g., https://instance.service-now.com)',
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
      description: 'Table name (e.g., incident, task, sys_user)',
    },
    fields: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Fields to set on the record (JSON object)',
    },
  },

  request: {
    url: (params) => {
      // Use instanceUrl if provided, otherwise fall back to idToken (stored instance URL from OAuth)
      const baseUrl = (params.instanceUrl || params.idToken || '').replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('ServiceNow instance URL is required')
      }
      return `${baseUrl}/api/now/table/${params.tableName}`
    },
    method: 'POST',
    headers: (params) => {
      const authHeader = getAuthHeader(params as ServiceNowCreateParams & { accessToken?: string })
      return {
        Authorization: authHeader,
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

  transformResponse: async (response: Response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        const error = data.error || data
        throw new Error(typeof error === 'string' ? error : error.message || JSON.stringify(error))
      }

      return {
        success: true,
        output: {
          record: data.result,
          metadata: {
            recordCount: 1,
          },
        },
      }
    } catch (error) {
      logger.error('ServiceNow create - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    record: {
      type: 'json',
      description: 'Created ServiceNow record with sys_id and other fields',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
    },
  },
}
