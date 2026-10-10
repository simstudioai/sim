import {
  type CheckrContinuousCheckIdParams,
  type CheckrContinuousCheckResponse,
  CONTINUOUS_CHECK_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapContinuousCheck,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrCancelContinuousCheckTool: ToolConfig<
  CheckrContinuousCheckIdParams,
  CheckrContinuousCheckResponse
> = {
  id: 'checkr_cancel_continuous_check',
  name: 'Checkr Cancel Continuous Check',
  description: 'Cancel a continuous check to stop monitoring the candidate.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    continuousCheckId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the continuous check to cancel',
    },
  },

  request: {
    url: (params) =>
      checkrUrl(`/continuous_checks/${checkrId(params.continuousCheckId, 'continuousCheckId')}`),
    method: 'DELETE',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { continuousCheck: mapContinuousCheck(data) } }
  },

  outputs: {
    continuousCheck: {
      type: 'object',
      description: 'The canceled continuous check',
      properties: CONTINUOUS_CHECK_PROPERTIES,
    },
  },
}
