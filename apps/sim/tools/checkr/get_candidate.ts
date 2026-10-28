import {
  CANDIDATE_PROPERTIES,
  type CheckrCandidateIdParams,
  type CheckrCandidateResponse,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapCandidate,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetCandidateTool: ToolConfig<CheckrCandidateIdParams, CheckrCandidateResponse> =
  {
    id: 'checkr_get_candidate',
    name: 'Checkr Get Candidate',
    description: 'Retrieve a candidate by ID, including their report and geo IDs.',
    version: '1.0.0',
    errorExtractor: CHECKR_ERROR_EXTRACTOR,

    params: {
      ...CHECKR_API_KEY_PARAM,
      candidateId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the candidate to retrieve',
      },
    },

    request: {
      url: (params) => checkrUrl(`/candidates/${checkrId(params.candidateId, 'candidateId')}`),
      method: 'GET',
      headers: (params) => checkrHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      return { success: true, output: { candidate: mapCandidate(data) } }
    },

    outputs: {
      candidate: { type: 'object', description: 'The candidate', properties: CANDIDATE_PROPERTIES },
    },
  }
