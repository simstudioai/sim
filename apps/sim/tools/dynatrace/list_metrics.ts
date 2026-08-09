import {
  metricDescriptorProperties,
  nextPageKeyOutput,
  totalCountOutput,
  warningsOutput,
} from '@/tools/dynatrace/outputs'
import type {
  DynatraceListMetricsParams,
  DynatraceListMetricsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapMetricDescriptor,
  mapWarnings,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listMetricsTool: ToolConfig<DynatraceListMetricsParams, DynatraceListMetricsResponse> =
  {
    id: 'dynatrace_list_metrics',
    name: 'Dynatrace List Metrics',
    description:
      'Discover the metrics available in a Dynatrace environment, filtered by metric selector, free text, or metadata.',
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
        required: false,
        visibility: 'user-or-llm',
        description: 'Metric selector, supporting wildcards (e.g. builtin:host.cpu.*)',
      },
      text: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Free-text search across metric display names and descriptions',
      },
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated descriptor properties. Prefix with + to add a non-default property and - to drop a default one; metricId is always returned (e.g. +aggregationTypes,-description)',
      },
      writtenSince: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Only metrics written since this point, as UTC milliseconds, ISO 8601, or a relative expression such as now-7d',
      },
      writtenSinceMode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'INCLUDE (default) keeps metrics written since Written Since; EXCLUDE keeps the ones not written since then',
      },
      metadataSelector: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Metadata selector, e.g. unit("Percent"),tags("dashboard")',
      },
      pageSize: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Metrics per page (max 500, default 100)',
      },
      nextPageKey: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Cursor for the next page. All other filters are ignored when it is set',
      },
    },

    request: {
      url: (params) =>
        params.nextPageKey
          ? buildDynatraceUrl(params.environmentUrl, '/metrics', {
              nextPageKey: params.nextPageKey,
            })
          : buildDynatraceUrl(params.environmentUrl, '/metrics', {
              metricSelector: params.metricSelector,
              text: params.text,
              fields: params.fields,
              writtenSince: params.writtenSince,
              writtenSinceMode: params.writtenSinceMode,
              metadataSelector: params.metadataSelector,
              pageSize: params.pageSize,
            }),
      method: 'GET',
      headers: (params) => dynatraceHeaders(params.apiToken),
    },

    transformResponse: async (response: Response) => {
      const data = await readJsonBody(response)
      const metrics = Array.isArray(data.metrics)
        ? (data.metrics as Array<Record<string, unknown>>)
        : []

      return {
        success: true,
        output: {
          metrics: metrics.map(mapMetricDescriptor),
          totalCount: (data.totalCount as number) ?? null,
          nextPageKey: (data.nextPageKey as string) ?? null,
          warnings: mapWarnings(data.warnings),
        },
      }
    },

    outputs: {
      metrics: {
        type: 'array',
        description: 'Matching metric descriptors',
        items: { type: 'object', properties: metricDescriptorProperties },
      },
      totalCount: totalCountOutput,
      nextPageKey: nextPageKeyOutput,
      warnings: warningsOutput,
    },
  }
