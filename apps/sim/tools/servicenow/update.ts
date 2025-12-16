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

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow instance URL',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow password',
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
      const baseUrl = params.instanceUrl.replace(/\/$/, '')
      return `${baseUrl}/api/now/table/${params.tableName}/${params.sysId}`
    },
    method: 'PATCH',
    headers: (params) => {
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

