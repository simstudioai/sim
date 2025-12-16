import { createLogger } from '@/lib/logs/console/logger'
import type { ServiceNowDeleteParams, ServiceNowDeleteResponse } from '@/tools/servicenow/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowDeleteTool')

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

export const deleteTool: ToolConfig<ServiceNowDeleteParams, ServiceNowDeleteResponse> = {
  id: 'servicenow_delete',
  name: 'Delete ServiceNow Record',
  description: 'Delete a record from a ServiceNow table',
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
      description: 'Record sys_id to delete',
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
    method: 'DELETE',
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

  transformResponse: async (response: Response, params?: ServiceNowDeleteParams) => {
    try {
      if (!response.ok) {
        let errorData: any
        try {
          errorData = await response.json()
        } catch {
          errorData = { status: response.status, statusText: response.statusText }
        }
        throw new Error(
          typeof errorData === 'string'
            ? errorData
            : errorData.error?.message || JSON.stringify(errorData)
        )
      }

      return {
        success: true,
        output: {
          success: true,
          metadata: {
            deletedSysId: params?.sysId || '',
          },
        },
      }
    } catch (error) {
      logger.error('ServiceNow delete - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the deletion was successful',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
    },
  },
}

