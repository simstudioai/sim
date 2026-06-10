import { createLogger } from '@sim/logger'
import type {
  ServiceNowAggregateParams,
  ServiceNowAggregateResponse,
} from '@/tools/servicenow/types'
import { createBasicAuthHeader } from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ServiceNowAggregateTool')

export const aggregateTool: ToolConfig<ServiceNowAggregateParams, ServiceNowAggregateResponse> = {
  id: 'servicenow_aggregate',
  name: 'Aggregate ServiceNow Records',
  description:
    'Compute aggregate statistics (count, sum, average, min, max, group by) over a ServiceNow table',
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
      description: 'Table name (e.g., incident, change_request, task)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Encoded query string to filter records before aggregating (e.g., "active=true")',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return the count of matching records',
    },
    groupBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to group results by (e.g., category,priority)',
    },
    avgFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated numeric fields to average (e.g., reassignment_count)',
    },
    sumFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated numeric fields to sum',
    },
    minFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to compute the minimum of',
    },
    maxFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to compute the maximum of',
    },
    having: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter on aggregate results (e.g., "count>5")',
    },
    displayValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return display values for grouped reference fields: "true", "false", or "all"',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.instanceUrl.trim().replace(/\/$/, '')
      if (!baseUrl) {
        throw new Error('ServiceNow instance URL is required')
      }
      const url = `${baseUrl}/api/now/stats/${params.tableName.trim()}`

      const queryParams = new URLSearchParams()

      if (params.query) {
        queryParams.append('sysparm_query', params.query)
      }
      if (params.count) {
        queryParams.append('sysparm_count', 'true')
      }
      if (params.groupBy) {
        queryParams.append('sysparm_group_by', params.groupBy)
      }
      if (params.avgFields) {
        queryParams.append('sysparm_avg_fields', params.avgFields)
      }
      if (params.sumFields) {
        queryParams.append('sysparm_sum_fields', params.sumFields)
      }
      if (params.minFields) {
        queryParams.append('sysparm_min_fields', params.minFields)
      }
      if (params.maxFields) {
        queryParams.append('sysparm_max_fields', params.maxFields)
      }
      if (params.having) {
        queryParams.append('sysparm_having', params.having)
      }
      if (params.displayValue) {
        queryParams.append('sysparm_display_value', params.displayValue)
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

      const result = data.result ?? null
      const grouped = Array.isArray(result)
      const count = !grouped && result?.stats?.count != null ? Number(result.stats.count) : null

      return {
        success: true,
        output: {
          result,
          count,
          metadata: {
            grouped,
            groupCount: grouped ? result.length : null,
          },
        },
      }
    } catch (error) {
      logger.error('ServiceNow aggregate - Error processing response:', { error })
      throw error
    }
  },

  outputs: {
    result: {
      type: 'json',
      description:
        'Aggregate result. Ungrouped: {stats: {count, sum, avg, min, max}}. Grouped: array of {stats, groupby_fields}.',
    },
    count: {
      type: 'number',
      description: 'Total matching record count (only present for ungrouped count queries)',
      optional: true,
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata (grouped, groupCount)',
    },
  },
}
