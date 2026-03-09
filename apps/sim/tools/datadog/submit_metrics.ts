import type { SubmitMetricsParams, SubmitMetricsResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

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
        'JSON array of metric series to submit. Each series should include metric name, type (gauge/rate/count), points (timestamp/value pairs), and optional tags.',
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
      let series: any[]
      try {
        series = typeof params.series === 'string' ? JSON.parse(params.series) : params.series
      } catch {
        throw new Error('Invalid JSON in series parameter')
      }

      // Transform to Datadog API v2 format
      const formattedSeries = series.map((s: any) => ({
        metric: s.metric,
        type: s.type === 'gauge' ? 0 : s.type === 'rate' ? 1 : s.type === 'count' ? 2 : 3,
        points: s.points.map((p: any) => ({
          timestamp: p.timestamp,
          value: p.value,
        })),
        tags: s.tags || [],
        unit: s.unit,
        resources: s.resources || [{ name: 'host', type: 'host' }],
      }))

      return { series: formattedSeries }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          success: false,
          errors: [errorData.errors?.[0] || `HTTP ${response.status}: ${response.statusText}`],
        },
        error: errorData.errors?.[0] || `HTTP ${response.status}: ${response.statusText}`,
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
