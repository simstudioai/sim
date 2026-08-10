import { totalCountOutput, warningsOutput } from '@/tools/dynatrace/outputs'
import type {
  DynatraceQueryMetricsParams,
  DynatraceQueryMetricsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapMetricResult,
  mapWarnings,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const queryMetricsTool: ToolConfig<
  DynatraceQueryMetricsParams,
  DynatraceQueryMetricsResponse
> = {
  id: 'dynatrace_query_metrics',
  name: 'Dynatrace Query Metrics',
  description:
    'Read metric data points from Dynatrace using a metric selector, with optional entity and management-zone scoping.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.DYNATRACE_ERRORS,

  params: {
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/abc12345 for Managed)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dynatrace access token (dt0c01...) with the metrics.read scope',
    },
    metricSelector: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Metric selector, up to 10 metrics comma-separated, with optional transformations after a colon (e.g. builtin:host.cpu.usage:avg:names)',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-2h. Defaults to now-2h',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the timeframe in the same formats as From. Defaults to now',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of data points (default 120), a timespan such as 10m or 3w, or Inf for a single aggregated value',
    },
    entitySelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Entity selector scoping the query, e.g. type("HOST"),tag("env:prod")',
    },
    mzSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Management zone selector, e.g. mzName("Production")',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, '/metrics/query', {
        metricSelector: params.metricSelector,
        from: params.from,
        to: params.to,
        resolution: params.resolution,
        entitySelector: params.entitySelector,
        mzSelector: params.mzSelector,
      }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const result = Array.isArray(data.result) ? (data.result as Array<Record<string, unknown>>) : []

    return {
      success: true,
      output: {
        result: result.map(mapMetricResult),
        resolution: (data.resolution as string) ?? null,
        totalCount: (data.totalCount as number) ?? null,
        warnings: mapWarnings(data.warnings),
      },
    }
  },

  outputs: {
    result: {
      type: 'array',
      description: 'One entry per queried metric',
      items: {
        type: 'object',
        properties: {
          metricId: { type: 'string', description: 'Metric key including transformations' },
          dataPointCountRatio: {
            type: 'number',
            description: 'Queried data points relative to the query limit',
            nullable: true,
          },
          dimensionCountRatio: {
            type: 'number',
            description: 'Queried dimension tuples relative to the query limit',
            nullable: true,
          },
          appliedOptionalFilters: {
            type: 'array',
            description: 'Optional filters Dynatrace applied to the query',
            items: { type: 'object' },
          },
          dql: {
            type: 'json',
            description: 'DQL translation of the query, when available',
            nullable: true,
            properties: {
              status: { type: 'string', description: 'Whether the translation succeeded' },
              query: { type: 'string', description: 'The equivalent DQL query' },
            },
          },
          warnings: {
            type: 'array',
            description: 'Warnings for this metric',
            items: { type: 'string' },
          },
          data: {
            type: 'array',
            description: 'Series of the metric, one per dimension tuple',
            items: {
              type: 'object',
              properties: {
                dimensions: {
                  type: 'array',
                  description: 'Dimension values of the series',
                  items: { type: 'string' },
                },
                dimensionMap: {
                  type: 'json',
                  description: 'Dimension values keyed by dimension key',
                },
                timestamps: {
                  type: 'array',
                  description: 'Timestamps in UTC milliseconds, one per value',
                  items: { type: 'number' },
                },
                values: {
                  type: 'array',
                  description: 'Metric values. Null where no data exists',
                  items: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    resolution: {
      type: 'string',
      description: 'Resolution Dynatrace actually used',
      nullable: true,
    },
    totalCount: totalCountOutput,
    warnings: warningsOutput,
  },
}
