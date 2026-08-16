import { filterUndefined } from '@sim/utils/object'
import type {
  MetricSeries,
  SubmitMetricsParams,
  SubmitMetricsResponse,
} from '@/tools/datadog/types'
import { datadogErrorMessage, parseJsonParam } from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Datadog `MetricIntakeType` codes: 0 unspecified, 1 count, 2 rate, 3 gauge.
 * A metric with no recognized type is submitted without a `type`, letting Datadog
 * infer it rather than silently mislabeling the series.
 */
const METRIC_INTAKE_TYPE = {
  count: 1,
  rate: 2,
  gauge: 3,
} as const

export const submitMetricsTool: ToolConfig<SubmitMetricsParams, SubmitMetricsResponse> = {
  id: 'datadog_submit_metrics',
  name: 'Datadog Submit Metrics',
  description:
    'Submit custom metrics to Datadog. Use for tracking application performance, business metrics, or custom monitoring data.',
  version: '1.0.0',

  params: {
    series: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of metric series to submit. Each entry needs "metric" and "points" (objects with "timestamp" in POSIX seconds and a numeric "value"); timestamps cannot be more than 10 minutes in the future or 1 hour in the past. Optional per entry: "type" ("count", "rate", or "gauge"; omit to let Datadog infer), "interval" in seconds (required by Datadog for count and rate), "tags", "unit", "sourceTypeName", and "resources".',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
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
      return `https://api.${site}/api/v2/series`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'DD-API-KEY': params.apiKey,
    }),
    body: (params) => {
      const series = parseJsonParam<MetricSeries[]>(params.series, 'series parameter')
      if (!Array.isArray(series) || series.length === 0) {
        throw new Error('series must be a non-empty JSON array of metric series')
      }

      const formattedSeries = series.map((s) =>
        filterUndefined({
          metric: s.metric,
          type: METRIC_INTAKE_TYPE[s.type as keyof typeof METRIC_INTAKE_TYPE],
          points: s.points?.map((p) => ({ timestamp: p.timestamp, value: p.value })),
          tags: s.tags,
          unit: s.unit,
          interval: s.interval,
          source_type_name: s.sourceTypeName,
          resources: s.resources,
        })
      )

      return { series: formattedSeries }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const message = await datadogErrorMessage(response)
      return {
        success: false,
        output: { success: false, errors: [message] },
        error: message,
      }
    }

    const data = await response.json().catch(() => ({}))
    return {
      success: true,
      output: {
        success: true,
        errors: data.errors || [],
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the metrics were submitted successfully',
    },
    errors: {
      type: 'array',
      description: 'Any errors that occurred during submission',
    },
  },
}
