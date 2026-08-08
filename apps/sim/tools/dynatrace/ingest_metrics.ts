import type {
  DynatraceIngestMetricsParams,
  DynatraceIngestMetricsResponse,
} from '@/tools/dynatrace/types'
import { buildDynatraceUrl, dynatraceHeaders, readJsonBody } from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const ingestMetricsTool: ToolConfig<
  DynatraceIngestMetricsParams,
  DynatraceIngestMetricsResponse
> = {
  id: 'dynatrace_ingest_metrics',
  name: 'Dynatrace Ingest Metrics',
  description:
    'Push custom metric data points into Dynatrace using the metric line protocol, one data point per line.',
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
      description: 'Dynatrace access token (dt0c01...) with the metrics.ingest scope',
    },
    payload: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Metric line protocol payload, one data point per line, max 1 MB (e.g. cpu.temperature,dt.entity.host=HOST-06F288EE2A930951,cpu=1 55)',
    },
  },

  request: {
    url: (params) => buildDynatraceUrl(params.environmentUrl, '/metrics/ingest'),
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken, 'text/plain'),
    body: (params) => params.payload,
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        linesOk: (data.linesOk as number) ?? null,
        linesInvalid: (data.linesInvalid as number) ?? null,
        ingestError: (data.error as Record<string, unknown>) ?? null,
        warnings: (data.warnings as Record<string, unknown>) ?? null,
      },
    }
  },

  outputs: {
    linesOk: {
      type: 'number',
      description: 'Number of accepted data points',
      nullable: true,
    },
    linesInvalid: {
      type: 'number',
      description: 'Number of rejected data points',
      nullable: true,
    },
    ingestError: {
      type: 'json',
      description: 'Details of the invalid lines',
      nullable: true,
      properties: {
        code: { type: 'number', description: 'Error code' },
        message: { type: 'string', description: 'Error message' },
        invalidLines: {
          type: 'array',
          description: 'The rejected lines',
          items: {
            type: 'object',
            properties: {
              line: { type: 'number', description: 'Line number in the payload' },
              error: { type: 'string', description: 'Why the line was rejected' },
            },
          },
        },
      },
    },
    warnings: {
      type: 'json',
      description: 'Warnings raised during ingestion, such as changed metric keys',
      nullable: true,
      properties: {
        message: { type: 'string', description: 'Warning message' },
        changedMetricKeys: {
          type: 'array',
          description: 'Lines whose metric key Dynatrace rewrote',
          items: {
            type: 'object',
            properties: {
              line: { type: 'number', description: 'Line number in the payload' },
              warning: { type: 'string', description: 'What was changed' },
            },
          },
        },
      },
    },
  },
}
