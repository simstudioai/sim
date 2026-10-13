import {
  CANDIDATE_PROPERTIES,
  type CheckrCandidateResponse,
  type CheckrUpdateCandidateParams,
} from '@/tools/checkr/types'
import {
  buildCandidateBody,
  CANDIDATE_FIELD_PARAMS,
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapCandidate,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrUpdateCandidateTool: ToolConfig<
  CheckrUpdateCandidateParams,
  CheckrCandidateResponse
> = {
  id: 'checkr_update_candidate',
  name: 'Checkr Update Candidate',
  description:
    'Update a candidate. Once a report is ordered only empty fields can change, except email, phone, previous driver license, copy requested, custom ID, and geo IDs.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the candidate to update',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Candidate's email address",
    },
    ...CANDIDATE_FIELD_PARAMS,
  },

  request: {
    url: (params) => checkrUrl(`/candidates/${checkrId(params.candidateId, 'candidateId')}`),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body = buildCandidateBody(params)
      if (Object.keys(body).length === 0) {
        throw new Error('Provide at least one candidate field to update.')
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { candidate: mapCandidate(data) } }
  },

  outputs: {
    candidate: {
      type: 'object',
      description: 'The updated candidate',
      properties: CANDIDATE_PROPERTIES,
    },
  },
}
