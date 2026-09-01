import type { DynatraceUpdateSloParams, DynatraceUpdateSloResponse } from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  buildSloBody,
  dynatraceHeaders,
  encodeDynatraceId,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const updateSloTool: ToolConfig<DynatraceUpdateSloParams, DynatraceUpdateSloResponse> = {
  id: 'dynatrace_update_slo',
  name: 'Dynatrace Update SLO',
  description:
    'Update an existing service-level objective. Every field is replaced, so send the complete definition.',
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
    sloId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the SLO to update',
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
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, `/slo/${encodeDynatraceId(params.sloId)}`),
    method: 'PUT',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => buildSloBody(params),
  },

  /** Answers 200 with no documented body, so the updated identity is echoed back. */
  transformResponse: async (_response: Response, params?: DynatraceUpdateSloParams) => ({
    success: true,
    output: {
      sloId: params?.sloId ?? '',
      name: params?.name ?? '',
    },
  }),

  outputs: {
    sloId: { type: 'string', description: 'ID of the updated SLO' },
    name: { type: 'string', description: 'Name the SLO now carries' },
  },
}
