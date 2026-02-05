import { createLogger } from '@sim/logger'
import type { ServiceNowCreateParams, ServiceNowCreateResponse } from '@/tools/servicenow/types'
import { createBasicAuthHeader } from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowCreateRecordTool')

export const createRecordTool: ToolConfig<ServiceNowCreateParams, ServiceNowCreateResponse> = {
  id: 'servicenow_create_record',
  name: 'Create ServiceNow Record',
  description: 'Create a new record in a ServiceNow table',
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
      description: 'Table name (e.g., incident, task, sys_user)',
    },
    fields: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Fields to set on the record as JSON object (e.g., {"short_description": "Issue title", "priority": "1"})',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.instanceUrl.replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('ServiceNow instance URL is required')
      }
      return `${baseUrl}/api/now/table/${params.tableName}`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.username || !params.password) {
        throw new Error('ServiceNow username and password are required')
      }
      return {
        Authorization: createBasicAuthHeader(params.username, params.password),
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
      logger.error('ServiceNow create record - Error processing response:', { error })
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
