import { createLogger } from '@sim/logger'
import type { ServiceNowDeleteParams, ServiceNowDeleteResponse } from '@/tools/servicenow/types'
import { createBasicAuthHeader } from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowDeleteRecordTool')

export const deleteRecordTool: ToolConfig<ServiceNowDeleteParams, ServiceNowDeleteResponse> = {
  id: 'servicenow_delete_record',
  name: 'Delete ServiceNow Record',
  description: 'Delete a record from a ServiceNow table',
  version: '1.0.0',

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ServiceNow instance URL (e.g., https://instance.service-now.com)',
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
      description: 'Table name (e.g., incident, task, sys_user, change_request)',
    },
    sysId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Record sys_id to delete (e.g., 6816f79cc0a8016401c5a33be04be441)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.instanceUrl.replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('ServiceNow instance URL is required')
      }
      return `${baseUrl}/api/now/table/${params.tableName}/${params.sysId}`
    },
    method: 'DELETE',
    headers: (params) => {
      if (!params.username || !params.password) {
        throw new Error('ServiceNow username and password are required')
      }
      return {
        Authorization: createBasicAuthHeader(params.username, params.password),
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
