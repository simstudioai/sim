import { createLogger } from '@sim/logger'
import type {
  ServiceNowAggregateParams,
  ServiceNowAggregateResponse,
} from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  parseServiceNowResponse,
  toRecordArray,
  toRecordObject,
} from '@/tools/servicenow/utils'
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
      description:
        'Filter on aggregate results, written as aggregate^field^operator^value and comma-separated for more than one (e.g., "count^priority^>^3" or "count^state^=^1,avg^priority^>^3")',
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
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
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
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: async (response: Response) => {
    try {
      const data = await parseServiceNowResponse(response)

      /**
       * The Aggregate API answers with an array when `sysparm_group_by` is set
       * and a single object otherwise, so the two shapes are narrowed
       * separately rather than wrapped.
       */
      const grouped = Array.isArray(data.result)
      const groups = grouped ? toRecordArray(data.result) : []
      const result = grouped ? groups : toRecordObject(data.result)

      /**
       * `stats.count` arrives as a *string* ("42"), which is why this reads the
       * raw value and converts rather than accepting only a number — a numeric
       * type check drops every count the API actually returns. A value that is
       * not a finite number stays `null` instead of surfacing `NaN`.
       */
      const rawCount = grouped ? undefined : toRecordObject(toRecordObject(data.result).stats).count
      const parsedCount =
        typeof rawCount === 'string' || typeof rawCount === 'number' ? Number(rawCount) : Number.NaN
      const count = Number.isFinite(parsedCount) ? parsedCount : null

      return {
        success: true,
        output: {
          result,
          count,
          metadata: {
            grouped,
            groupCount: grouped ? groups.length : null,
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
