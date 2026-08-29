import type {
  MetricsQuerySeries,
  QueryTimeseriesParams,
  QueryTimeseriesResponse,
} from '@/tools/datadog/types'
import { datadogErrorMessage, resolveDatadogSite } from '@/tools/datadog/utils'
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
      const site = resolveDatadogSite(params.site)
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
      const message = await datadogErrorMessage(response)
      return {
        success: false,
        output: {
          series: [],
          status: 'error',
        },
        error: message,
      }
    }

    const data = await response.json()

    /**
     * A failed metrics query still returns 200; Datadog signals it with a non-`ok`
     * `status` and puts the reason in `error`. Without this the caller gets an empty
     * series and no indication anything went wrong.
     */
    if (data.status && data.status !== 'ok') {
      return {
        success: false,
        output: { series: [], status: data.status },
        error: data.error || `Datadog returned query status "${data.status}"`,
      }
    }

    const series = (data.series || []).map((s: MetricsQuerySeries) => ({
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
        status: data.status,
      },
    }
  },

  outputs: {
    series: {
      type: 'array',
      description: 'Array of timeseries data with metric name, tags, and data points',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string', description: 'Metric name' },
          tags: { type: 'array', description: 'Tags attached to the series' },
          points: {
            type: 'array',
            description: 'Data points',
            items: {
              type: 'object',
              properties: {
                timestamp: { type: 'number', description: 'Point timestamp (Unix seconds)' },
                value: { type: 'number', description: 'Point value' },
              },
            },
          },
        },
      },
    },
    status: {
      type: 'string',
      description: 'Query status',
    },
  },
}
