import { createLogger } from '@sim/logger'
import type { ServiceNowUpdateParams, ServiceNowUpdateResponse } from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  parseServiceNowResponse,
  toRecordObject,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowUpdateRecordTool')

export const updateRecordTool: ToolConfig<ServiceNowUpdateParams, ServiceNowUpdateResponse> = {
  id: 'servicenow_update_record',
  name: 'Update ServiceNow Record',
  description: 'Update an existing record in a ServiceNow table',
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
      description: 'Record sys_id to update (e.g., 6816f79cc0a8016401c5a33be04be441)',
    },
    fields: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Fields to update as JSON object (e.g., {"state": "2", "priority": "1"})',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      return `${baseUrl}/api/now/table/${params.tableName.trim()}/${params.sysId.trim()}`
    },
    method: 'PATCH',
    headers: (params) => buildServiceNowHeaders(params, { json: true }),
    body: (params) => {
      if (!params.fields || typeof params.fields !== 'object') {
        throw new Error('Fields must be a JSON object')
      }
      return params.fields
    },
  },

  transformResponse: async (response: Response, params?: ServiceNowUpdateParams) => {
    try {
      const data = await parseServiceNowResponse(response)

      return {
        success: true,
        output: {
          /** Declared non-nullable — see the same narrowing in `create_record`. */
          record: toRecordObject(data.result),
          metadata: {
            recordCount: 1,
            updatedFields: params ? Object.keys(params.fields || {}) : [],
          },
        },
      }
    } catch (error) {
      logger.error('ServiceNow update record - Error processing response:', { error })
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
