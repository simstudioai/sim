import { createLogger } from '@sim/logger'
import type { ServiceNowReadParams, ServiceNowReadResponse } from '@/tools/servicenow/types'
import { createBasicAuthHeader } from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowReadRecordTool')

export const readRecordTool: ToolConfig<ServiceNowReadParams, ServiceNowReadResponse> = {
  id: 'servicenow_read_record',
  name: 'Read ServiceNow Records',
  description: 'Read records from a ServiceNow table',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific record sys_id (e.g., 6816f79cc0a8016401c5a33be04be441)',
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
      visibility: 'user-or-llm',
      description: 'Maximum number of records to return (e.g., 10, 50, 100)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return (e.g., sys_id,number,short_description,state)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.instanceUrl.replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('ServiceNow instance URL is required')
      }
      let url = `${baseUrl}/api/now/table/${params.tableName}`

      const queryParams = new URLSearchParams()

      if (params.sysId) {
        url = `${url}/${params.sysId}`
      } else if (params.number) {
        const numberQuery = `number=${params.number}`
        const existingQuery = params.query
        queryParams.append(
          'sysparm_query',
          existingQuery ? `${existingQuery}^${numberQuery}` : numberQuery
        )
      } else if (params.query) {
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
      if (!params.username || !params.password) {
        throw new Error('ServiceNow username and password are required')
      }
      return {
        Authorization: createBasicAuthHeader(params.username, params.password),
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        const error = data.error || data
        throw new Error(typeof error === 'string' ? error : error.message || JSON.stringify(error))
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
      logger.error('ServiceNow read record - Error processing response:', { error })
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
