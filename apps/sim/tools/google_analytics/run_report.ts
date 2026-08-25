import {
  extractGoogleApiError,
  flattenRows,
  type GoogleAnalyticsRunReportParams,
  type GoogleAnalyticsRunReportResponse,
  normalizePropertyName,
  parseJsonParam,
  toBooleanParam,
  toDimensionHeaderNames,
  toMetricAggregations,
  toMetricHeaders,
  toNameList,
  toOptionalNumberParam,
  toReportMetadata,
  validateDateRangeValue,
} from '@/tools/google_analytics/types'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_START_DATE = '28daysAgo'
const DEFAULT_END_DATE = 'today'

interface DateRange {
  startDate: string
  endDate: string
  name?: string
}

/**
 * Builds the `dateRanges` body field. An explicit JSON array wins; otherwise the
 * start/end pair is used, defaulting to the trailing 28 days GA4 shows by default.
 */
function buildDateRanges(params: GoogleAnalyticsRunReportParams): DateRange[] {
  const explicit = parseJsonParam<DateRange[]>(params.dateRanges, 'dateRanges')
  if (explicit) return explicit
  return [
    {
      startDate: validateDateRangeValue(params.startDate || DEFAULT_START_DATE, 'startDate'),
      endDate: validateDateRangeValue(params.endDate || DEFAULT_END_DATE, 'endDate'),
    },
  ]
}

export const googleAnalyticsRunReportTool: ToolConfig<
  GoogleAnalyticsRunReportParams,
  GoogleAnalyticsRunReportResponse
> = {
  id: 'google_analytics_run_report',
  name: 'Run Google Analytics Report',
  description:
    'Run a Google Analytics 4 report over a date range with the chosen dimensions and metrics',
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
      description: 'Comma-separated metric API names (e.g. activeUsers, sessions, screenPageViews)',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated dimension API names (e.g. date, country, pagePath)',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date: YYYY-MM-DD, "today", "yesterday", or "NdaysAgo"',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date: YYYY-MM-DD, "today", "yesterday", or "NdaysAgo"',
    },
    dateRanges: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of DateRange objects, overriding startDate/endDate (e.g. [{"startDate":"2024-01-01","endDate":"2024-01-31"}])',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum rows to return (default 10000, max 250000)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Zero-based row offset for pagination',
    },
    currencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 4217 currency code for revenue metrics (e.g. USD)',
    },
    keepEmptyRows: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include rows where every metric is zero',
    },
  },

  request: {
    url: (params) =>
      `https://analyticsdata.googleapis.com/v1beta/${normalizePropertyName(params.propertyId)}:runReport`,
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
        dateRanges: buildDateRanges(params),
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

      const metricAggregations = toMetricAggregations(params.metricAggregations)
      if (metricAggregations.length > 0) body.metricAggregations = metricAggregations

      const limit = toOptionalNumberParam(params.limit)
      if (limit !== undefined) body.limit = limit

      const offset = toOptionalNumberParam(params.offset)
      if (offset !== undefined) body.offset = offset
      if (params.currencyCode) body.currencyCode = params.currencyCode

      const keepEmptyRows = toBooleanParam(params.keepEmptyRows)
      if (keepEmptyRows !== undefined) body.keepEmptyRows = keepEmptyRows

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
          metadata: null,
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
        metadata: toReportMetadata(data.metadata),
      },
    }
  },

  outputs: {
    rows: {
      type: 'array',
      description: 'Report rows, each keyed by dimension and metric API name',
      items: {
        type: 'json',
        description: 'One report row',
      },
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
      description: 'Total rows matching the query, ignoring limit and offset',
    },
    metadata: {
      type: 'json',
      description: 'Report metadata: currency, time zone, sampling and thresholding flags',
      nullable: true,
      properties: {
        currencyCode: { type: 'string', description: 'Property currency code', nullable: true },
        timeZone: { type: 'string', description: 'Property time zone', nullable: true },
        emptyReason: { type: 'string', description: 'Why the report is empty', nullable: true },
        dataLossFromOtherRow: {
          type: 'boolean',
          description: 'Whether high-cardinality rows were rolled into "(other)"',
        },
        subjectToThresholding: {
          type: 'boolean',
          description: 'Whether minimum aggregation thresholds were applied',
        },
      },
    },
  },
}
