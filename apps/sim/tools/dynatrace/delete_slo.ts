import type { DynatraceDeleteSloParams, DynatraceDeleteSloResponse } from '@/tools/dynatrace/types'
import { buildDynatraceUrl, dynatraceHeaders, encodeDynatraceId } from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const deleteSloTool: ToolConfig<DynatraceDeleteSloParams, DynatraceDeleteSloResponse> = {
  id: 'dynatrace_delete_slo',
  name: 'Dynatrace Delete SLO',
  description: 'Delete a service-level objective.',
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
      description: 'ID of the SLO to delete',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, `/slo/${encodeDynatraceId(params.sloId)}`),
    method: 'DELETE',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  /** The endpoint answers 204 with no body, so the deleted ID is echoed back. */
  transformResponse: async (_response: Response, params?: DynatraceDeleteSloParams) => ({
    success: true,
    output: {
      sloId: params?.sloId ?? '',
      deleted: true,
    },
  }),

  outputs: {
    sloId: { type: 'string', description: 'ID of the deleted SLO' },
    deleted: { type: 'boolean', description: 'Always true — a failed delete raises instead' },
  },
}
