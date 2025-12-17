import { createLogger } from '@/lib/logs/console/logger'
import type { ServiceNowDeleteParams, ServiceNowDeleteResponse } from '@/tools/servicenow/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowDeleteRecordTool')

export const deleteRecordTool: ToolConfig<ServiceNowDeleteParams, ServiceNowDeleteResponse> = {
  id: 'servicenow_delete_record',
  name: 'Delete ServiceNow Record',
  description: 'Delete a record from a ServiceNow table',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'servicenow',
  },

  params: {
    instanceUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ServiceNow instance URL (auto-detected from OAuth if not provided)',
    },
    credential: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'ServiceNow OAuth credential ID',
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
      if (!params.accessToken) {
        throw new Error('OAuth access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
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
      logger.error('ServiceNow delete record - Error processing response:', { error })
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
