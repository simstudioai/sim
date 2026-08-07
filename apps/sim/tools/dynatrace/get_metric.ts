import { metricDescriptorProperties } from '@/tools/dynatrace/outputs'
import type { DynatraceGetMetricParams, DynatraceGetMetricResponse } from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatracePathSegment,
  mapMetricDescriptor,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const getMetricTool: ToolConfig<DynatraceGetMetricParams, DynatraceGetMetricResponse> = {
  id: 'dynatrace_get_metric',
  name: 'Dynatrace Get Metric Descriptor',
  description:
    'Get the descriptor of a single Dynatrace metric — its unit, dimensions, supported aggregations, and transformations.',
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
    metricKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Metric key, optionally followed by transformation operators separated by a colon (e.g. builtin:host.cpu.usage)',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/metrics/${encodeDynatracePathSegment(params.metricKey)}`
      ),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        metric: mapMetricDescriptor(data),
      },
    }
  },

  outputs: {
    metric: {
      type: 'object',
      description: 'The requested metric descriptor',
      properties: metricDescriptorProperties,
    },
  },
}
