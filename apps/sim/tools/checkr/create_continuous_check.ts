import {
  type CheckrContinuousCheckResponse,
  type CheckrCreateContinuousCheckParams,
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
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrCreateContinuousCheckTool: ToolConfig<
  CheckrCreateContinuousCheckParams,
  CheckrContinuousCheckResponse
> = {
  id: 'checkr_create_continuous_check',
  name: 'Checkr Create Continuous Check',
  description:
    'Enroll a candidate in continuous criminal or motor vehicle monitoring so new records trigger a report.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the candidate to enroll',
    },
    continuousCheckType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of monitoring: criminal or mvr',
    },
    mvrEnrollmentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For mvr checks, the enrollment type: commercial for commercial drivers or standard',
    },
    ...CHECKR_HIERARCHY_PARAMS,
  },

  request: {
    url: (params) =>
      checkrUrl(`/candidates/${checkrId(params.candidateId, 'candidateId')}/continuous_checks`),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { type: trimmed(params.continuousCheckType) }
      const mvrEnrollmentType = trimmed(params.mvrEnrollmentType)
      if (mvrEnrollmentType) body.mvr_enrollment_type = mvrEnrollmentType
      applyHierarchyFields(body, params)
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
      description: 'The created continuous check',
      properties: CONTINUOUS_CHECK_PROPERTIES,
    },
  },
}
