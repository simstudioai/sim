import type { DynatraceCreateSloParams, DynatraceCreateSloResponse } from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  buildSloBody,
  dynatraceHeaders,
  idFromLocationHeader,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const createSloTool: ToolConfig<DynatraceCreateSloParams, DynatraceCreateSloResponse> = {
  id: 'dynatrace_create_slo',
  name: 'Dynatrace Create SLO',
  description:
    'Create a service-level objective from a metric expression, target, and evaluation timeframe.',
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
      description: 'Dynatrace access token (dt0c01...) with the slo.write scope',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the SLO',
    },
    target: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target success rate as a percentage, e.g. 99.5',
    },
    warning: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Warning threshold as a percentage. Must sit above the target, e.g. 99.8',
    },
    timeframe: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Evaluation timeframe in Dynatrace notation, e.g. -1d, -1w, or now-30d',
    },
    evaluationType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      default: 'AGGREGATE',
      description: 'Evaluation type. AGGREGATE is the only value the API accepts',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the SLO',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the SLO is evaluated. Dynatrace defaults it to false',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Entity filter scoping the SLO, e.g. type("SERVICE"),tag("env:prod")',
    },
    metricExpression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Metric expression the SLO evaluates, e.g. (100)*(builtin:service.errors.total.successCount:splitBy())/(builtin:service.requestCount.total:splitBy())',
    },
    metricName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name for the SLO metric',
    },
    burnRateVisualizationEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Show the error-budget burn rate on the SLO',
    },
    fastBurnThreshold: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Burn rate above which the SLO is considered fast-burning',
    },
  },

  request: {
    url: (params) => buildDynatraceUrl(params.environmentUrl, '/slo'),
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => buildSloBody(params),
  },

  /** Answers 201 with no body — the new SLO's ID arrives in the Location header. */
  transformResponse: async (response: Response, params?: DynatraceCreateSloParams) => ({
    success: true,
    output: {
      sloId: idFromLocationHeader(response),
      name: params?.name ?? '',
    },
  }),

  outputs: {
    sloId: {
      type: 'string',
      description: 'ID of the created SLO, read from the Location header',
      nullable: true,
    },
    name: { type: 'string', description: 'Name the SLO was created with' },
  },
}
