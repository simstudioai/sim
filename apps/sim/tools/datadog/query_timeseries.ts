import type { QueryTimeseriesParams, QueryTimeseriesResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

export const queryTimeseriesTool: ToolConfig<QueryTimeseriesParams, QueryTimeseriesResponse> = {
  id: 'datadog_query_timeseries',
  name: 'Datadog Query Timeseries',
  description:
    'Query metric timeseries data from Datadog. Use for analyzing trends, creating reports, or retrieving metric values.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Datadog metrics query (e.g., "avg:system.cpu.user{*}", "sum:nginx.requests{env:prod}.as_count()")',
    },
    from: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start time as Unix timestamp in seconds (e.g., 1705320000)',
    },
    to: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'End time as Unix timestamp in seconds (e.g., 1705323600)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) => {
      const site = params.site || 'datadoghq.com'
      const queryParams = new URLSearchParams({
        query: params.query,
        from: String(params.from),
        to: String(params.to),
      })
      return `https://api.${site}/api/v1/query?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'DD-API-KEY': params.apiKey,
      'DD-APPLICATION-KEY': params.applicationKey,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          series: [],
          status: 'error',
        },
        error: errorData.errors?.[0] || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const series = (data.series || []).map((s: any) => ({
      metric: s.metric || s.expression,
      tags: s.tag_set || [],
      points: (s.pointlist || []).map((p: [number, number]) => ({
        timestamp: p[0] / 1000, // Convert from milliseconds to seconds
        value: p[1],
      })),
    }))

    return {
      success: true,
      output: {
        series,
        status: data.status || 'ok',
      },
    }
  },

  outputs: {
    series: {
      type: 'array',
      description: 'Array of timeseries data with metric name, tags, and data points',
    },
    status: {
      type: 'string',
      description: 'Query status',
    },
  },
}
