import {
  extractGoogleApiError,
  flattenRows,
  type GoogleAnalyticsPivotHeader,
  type GoogleAnalyticsRunPivotReportParams,
  type GoogleAnalyticsRunPivotReportResponse,
  normalizePropertyName,
  parseJsonParam,
  toBooleanParam,
  toDimensionHeaderNames,
  toMetricHeaders,
  toNameList,
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

interface RawPivotHeader {
  rowCount?: number
  pivotDimensionHeaders?: Array<{ dimensionValues?: Array<{ value?: string }> }>
}

function toPivotHeaders(headers: RawPivotHeader[] | undefined): GoogleAnalyticsPivotHeader[] {
  return (headers ?? []).map((header) => ({
    rowCount: header?.rowCount ?? 0,
    dimensionValues: (header?.pivotDimensionHeaders ?? []).map((entry) =>
      (entry?.dimensionValues ?? []).map((cell) => cell?.value ?? '')
    ),
  }))
}

export const googleAnalyticsRunPivotReportTool: ToolConfig<
  GoogleAnalyticsRunPivotReportParams,
  GoogleAnalyticsRunPivotReportResponse
> = {
  id: 'google_analytics_run_pivot_report',
  name: 'Run Google Analytics Pivot Report',
  description:
    'Run a customized pivot report on a Google Analytics 4 property, cross-tabulating dimensions',
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
      description: 'Comma-separated metric API names',
    },
    dimensions: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated dimension API names referenced by the pivots',
    },
    pivots: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of Pivot objects (e.g. [{"fieldNames":["country"],"limit":10},{"fieldNames":["browser"],"limit":5}])',
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
      description: 'JSON array of DateRange objects, overriding startDate/endDate',
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
      `https://analyticsdata.googleapis.com/v1beta/${normalizePropertyName(params.propertyId)}:runPivotReport`,
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

      const dimensions = toNameList(params.dimensions)
      if (dimensions.length === 0) {
        throw new Error('At least one dimension is required for a pivot report')
      }

      const pivots = parseJsonParam<unknown[]>(params.pivots, 'pivots')
      if (!Array.isArray(pivots) || pivots.length === 0) {
        throw new Error('pivots must be a non-empty JSON array of Pivot objects')
      }

      const explicitRanges = parseJsonParam<DateRange[]>(params.dateRanges, 'dateRanges')
      const dateRanges = explicitRanges ?? [
        {
          startDate: validateDateRangeValue(params.startDate || DEFAULT_START_DATE, 'startDate'),
          endDate: validateDateRangeValue(params.endDate || DEFAULT_END_DATE, 'endDate'),
        },
      ]

      const body: Record<string, unknown> = {
        metrics: metrics.map((name) => ({ name })),
        dimensions: dimensions.map((name) => ({ name })),
        pivots,
        dateRanges,
      }

      const dimensionFilter = parseJsonParam(params.dimensionFilter, 'dimensionFilter')
      if (dimensionFilter) body.dimensionFilter = dimensionFilter

      const metricFilter = parseJsonParam(params.metricFilter, 'metricFilter')
      if (metricFilter) body.metricFilter = metricFilter

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
          aggregates: [],
          pivotHeaders: [],
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
        aggregates: flattenRows(data.aggregates, dimensionHeaders, metricHeaders),
        pivotHeaders: toPivotHeaders(data.pivotHeaders),
        metadata: toReportMetadata(data.metadata),
      },
    }
  },

  outputs: {
    rows: {
      type: 'array',
      description: 'Pivot rows, each keyed by dimension and metric API name',
      items: { type: 'json', description: 'One pivot row' },
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
    aggregates: {
      type: 'array',
      description: 'Aggregate rows for the pivot (totals, maximums, minimums)',
      items: { type: 'json', description: 'One aggregate row' },
    },
    pivotHeaders: {
      type: 'array',
      description: 'Per-pivot column headers and row counts',
      items: {
        type: 'json',
        description: 'Pivot header',
        properties: {
          rowCount: { type: 'number', description: 'Rows in this pivot' },
          dimensionValues: {
            type: 'array',
            description: 'Dimension value groups for each pivot column',
            items: { type: 'json', description: 'Dimension values for one pivot column' },
          },
        },
      },
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
