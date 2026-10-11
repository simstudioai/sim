import {
  type CheckrCandidateIdParams,
  type CheckrListContinuousChecksResponse,
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

export const checkrListContinuousChecksTool: ToolConfig<
  CheckrCandidateIdParams,
  CheckrListContinuousChecksResponse
> = {
  id: 'checkr_list_continuous_checks',
  name: 'Checkr List Continuous Checks',
  description: 'List the continuous checks a candidate is enrolled in.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the candidate',
    },
  },

  request: {
    url: (params) =>
      checkrUrl(`/candidates/${checkrId(params.candidateId, 'candidateId')}/continuous_checks`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        continuousChecks: (Array.isArray(data.data) ? data.data : []).map(mapContinuousCheck),
        count: typeof data.count === 'number' ? data.count : null,
      },
    }
  },

  outputs: {
    continuousChecks: {
      type: 'array',
      description: 'Continuous checks for the candidate',
      items: { type: 'object', properties: CONTINUOUS_CHECK_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of continuous checks', nullable: true },
  },
}
