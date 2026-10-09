import {
  ADVERSE_ACTION_PROPERTIES,
  type CheckrListAdverseActionsParams,
  type CheckrListAdverseActionsResponse,
  LIST_META_OUTPUTS,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapAdverseAction,
  mapListMeta,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListAdverseActionsTool: ToolConfig<
  CheckrListAdverseActionsParams,
  CheckrListAdverseActionsResponse
> = {
  id: 'checkr_list_adverse_actions',
  name: 'Checkr List Adverse Actions',
  description: 'List the adverse actions for a report, optionally filtered by context.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the report',
    },
    context: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return adverse actions with this context',
    },
  },

  request: {
    url: (params) =>
      checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/adverse_actions`, {
        context: params.context,
      }),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        adverseActions: (Array.isArray(data.data) ? data.data : []).map(mapAdverseAction),
        ...mapListMeta(data),
      },
    }
  },

  outputs: {
    adverseActions: {
      type: 'array',
      description: 'Adverse actions for the report',
      items: { type: 'object', properties: ADVERSE_ACTION_PROPERTIES },
    },
    ...LIST_META_OUTPUTS,
  },
}
