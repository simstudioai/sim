import {
  ADVERSE_ACTION_PROPERTIES,
  type CheckrAdverseActionIdParams,
  type CheckrAdverseActionResponse,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapAdverseAction,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrCancelAdverseActionTool: ToolConfig<
  CheckrAdverseActionIdParams,
  CheckrAdverseActionResponse
> = {
  id: 'checkr_cancel_adverse_action',
  name: 'Checkr Cancel Adverse Action',
  description: 'Cancel an adverse action so the post-adverse action notice is not sent.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    adverseActionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the adverse action to cancel',
    },
  },

  request: {
    url: (params) =>
      checkrUrl(`/adverse_actions/${checkrId(params.adverseActionId, 'adverseActionId')}`),
    method: 'DELETE',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { adverseAction: mapAdverseAction(data) } }
  },

  outputs: {
    adverseAction: {
      type: 'object',
      description: 'The canceled adverse action',
      properties: ADVERSE_ACTION_PROPERTIES,
    },
  },
}
