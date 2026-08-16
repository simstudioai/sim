import { createLogger } from '@sim/logger'
import type { ServiceNowCreateParams, ServiceNowCreateResponse } from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  parseServiceNowResponse,
  toRecordObject,
} from '@/tools/servicenow/utils'
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
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      return `${baseUrl}/api/now/table/${params.tableName.trim()}`
    },
    method: 'POST',
    headers: (params) => buildServiceNowHeaders(params, { json: true }),
    body: (params) => {
      if (!params.fields || typeof params.fields !== 'object') {
        throw new Error('Fields must be a JSON object')
      }
      return params.fields
    },
  },

  transformResponse: async (response: Response) => {
    try {
      const data = await parseServiceNowResponse(response)

      return {
        success: true,
        output: {
          /**
           * `record` is declared non-nullable, so passing `data.result` through
           * let an envelope without a `result` hand the next block `undefined`
           * under a contract that says it cannot be. `toRecordObject` narrows a
           * missing or non-object result to `{}` instead.
           */
          record: toRecordObject(data.result),
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
