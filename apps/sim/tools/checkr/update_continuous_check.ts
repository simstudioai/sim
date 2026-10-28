import {
  type CheckrContinuousCheckResponse,
  type CheckrUpdateContinuousCheckParams,
  CONTINUOUS_CHECK_PROPERTIES,
} from '@/tools/checkr/types'
import {
  applyHierarchyFields,
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_HIERARCHY_PARAMS,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapContinuousCheck,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrUpdateContinuousCheckTool: ToolConfig<
  CheckrUpdateContinuousCheckParams,
  CheckrContinuousCheckResponse
> = {
  id: 'checkr_update_continuous_check',
  name: 'Checkr Update Continuous Check',
  description: 'Change the node or work locations of a continuous check.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    continuousCheckId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the continuous check to update',
    },
    ...CHECKR_HIERARCHY_PARAMS,
  },

  request: {
    url: (params) =>
      checkrUrl(`/continuous_checks/${checkrId(params.continuousCheckId, 'continuousCheckId')}`),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      applyHierarchyFields(body, params)
      if (Object.keys(body).length === 0) {
        throw new Error('Provide a node or work locations to update.')
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { continuousCheck: mapContinuousCheck(data) } }
  },

  outputs: {
    continuousCheck: {
      type: 'object',
      description: 'The updated continuous check',
      properties: CONTINUOUS_CHECK_PROPERTIES,
    },
  },
}
