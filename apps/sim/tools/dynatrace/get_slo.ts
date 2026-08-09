import { sloProperties } from '@/tools/dynatrace/outputs'
import type { DynatraceGetSloParams, DynatraceGetSloResponse } from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  mapSlo,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const getSloTool: ToolConfig<DynatraceGetSloParams, DynatraceGetSloResponse> = {
  id: 'dynatrace_get_slo',
  name: 'Dynatrace Get SLO',
  description:
    'Get a single service-level objective with its evaluated attainment, error budget, and burn rate.',
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
      description: 'Dynatrace access token (dt0c01...) with the slo.read scope',
    },
    sloId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the SLO',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the evaluation timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-7d. Defaults to now-2w',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the evaluation timeframe in the same formats as From. Defaults to now',
    },
    timeFrame: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CURRENT evaluates the SLO over its own timeframe; GTF evaluates over the From/To range',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, `/slo/${encodeDynatraceId(params.sloId)}`, {
        from: params.from,
        to: params.to,
        timeFrame: params.timeFrame,
      }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        slo: mapSlo(data),
      },
    }
  },

  outputs: {
    slo: {
      type: 'object',
      description: 'The requested service-level objective',
      properties: sloProperties,
    },
  },
}
