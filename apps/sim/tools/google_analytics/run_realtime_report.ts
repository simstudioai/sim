import {
  extractGoogleApiError,
  flattenRows,
  type GoogleAnalyticsRunRealtimeReportParams,
  type GoogleAnalyticsRunRealtimeReportResponse,
  normalizePropertyName,
  parseJsonParam,
  toDimensionHeaderNames,
  toMetricAggregations,
  toMetricHeaders,
  toNameList,
  toOptionalNumberParam,
} from '@/tools/google_analytics/types'
import type { ToolConfig } from '@/tools/types'

export const googleAnalyticsRunRealtimeReportTool: ToolConfig<
  GoogleAnalyticsRunRealtimeReportParams,
  GoogleAnalyticsRunRealtimeReportResponse
> = {
  id: 'google_analytics_run_realtime_report',
  name: 'Run Google Analytics Realtime Report',
  description:
    'Report on activity from the last 30 minutes on a Google Analytics 4 property in real time',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-analytics',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Google Analytics Data API',
    },
    propertyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GA4 property ID (e.g. 123456789)',
    },
    metrics: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated realtime metric API names (e.g. activeUsers, screenPageViews)',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated realtime dimension API names (e.g. country, unifiedScreenName, eventName)',
    },
    dimensionFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON FilterExpression applied to dimensions',
    },
    metricFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON FilterExpression applied to metrics after aggregation',
    },
    orderBys: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of OrderBy objects controlling row ordering',
    },
    metricAggregations: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated aggregations to compute across all rows: TOTAL, MINIMUM, MAXIMUM, COUNT. Required for the totals, maximums, and minimums outputs to be populated',
    },
    minuteRanges: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of MinuteRange objects (e.g. [{"startMinutesAgo":29,"endMinutesAgo":0}]); defaults to the last 30 minutes',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum rows to return (default 10000, max 250000)',
    },
  },

  request: {
    url: (params) =>
      `https://analyticsdata.googleapis.com/v1beta/${normalizePropertyName(params.propertyId)}:runRealtimeReport`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const metrics = toNameList(params.metrics)
      if (metrics.length === 0) {
        throw new Error('At least one metric is required')
      }

      const body: Record<string, unknown> = {
        metrics: metrics.map((name) => ({ name })),
      }

      const dimensions = toNameList(params.dimensions)
      if (dimensions.length > 0) {
        body.dimensions = dimensions.map((name) => ({ name }))
      }

      const dimensionFilter = parseJsonParam(params.dimensionFilter, 'dimensionFilter')
      if (dimensionFilter) body.dimensionFilter = dimensionFilter

      const metricFilter = parseJsonParam(params.metricFilter, 'metricFilter')
      if (metricFilter) body.metricFilter = metricFilter

      const orderBys = parseJsonParam(params.orderBys, 'orderBys')
      if (orderBys) body.orderBys = orderBys

      const minuteRanges = parseJsonParam(params.minuteRanges, 'minuteRanges')
      if (minuteRanges) body.minuteRanges = minuteRanges

      const metricAggregations = toMetricAggregations(params.metricAggregations)
      if (metricAggregations.length > 0) body.metricAggregations = metricAggregations

      const limit = toOptionalNumberParam(params.limit)
      if (limit !== undefined) body.limit = limit

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {
          rows: [],
          dimensionHeaders: [],
          metricHeaders: [],
          totals: [],
          maximums: [],
          minimums: [],
          rowCount: 0,
        },
        error: extractGoogleApiError(data),
      }
    }

    const dimensionHeaders = toDimensionHeaderNames(data.dimensionHeaders)
    const metricHeaders = toMetricHeaders(data.metricHeaders)

    return {
      success: true,
      output: {
        rows: flattenRows(data.rows, dimensionHeaders, metricHeaders),
        dimensionHeaders,
        metricHeaders,
        totals: flattenRows(data.totals, dimensionHeaders, metricHeaders),
        maximums: flattenRows(data.maximums, dimensionHeaders, metricHeaders),
        minimums: flattenRows(data.minimums, dimensionHeaders, metricHeaders),
        rowCount: data.rowCount ?? 0,
      },
    }
  },

  outputs: {
    rows: {
      type: 'array',
      description: 'Realtime rows, each keyed by dimension and metric API name',
      items: { type: 'json', description: 'One realtime row' },
    },
    dimensionHeaders: {
      type: 'array',
      description: 'Dimension API names, in column order',
      items: { type: 'string', description: 'Dimension API name' },
    },
    metricHeaders: {
      type: 'array',
      description: 'Metric API names and value types, in column order',
      items: {
        type: 'json',
        description: 'Metric header',
        properties: {
          name: { type: 'string', description: 'Metric API name' },
          type: { type: 'string', description: 'Metric value type', nullable: true },
        },
      },
    },
    totals: {
      type: 'array',
      description: 'Summed rows, returned when metricAggregations requests TOTAL',
      items: { type: 'json', description: 'One total row' },
    },
    maximums: {
      type: 'array',
      description: 'Per-metric maximum rows, returned when metricAggregations requests MAXIMUM',
      items: { type: 'json', description: 'One maximum row' },
    },
    minimums: {
      type: 'array',
      description: 'Per-metric minimum rows, returned when metricAggregations requests MINIMUM',
      items: { type: 'json', description: 'One minimum row' },
    },
    rowCount: {
      type: 'number',
      description: 'Total rows matching the query, ignoring limit',
    },
  },
}
