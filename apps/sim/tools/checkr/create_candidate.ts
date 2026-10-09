import {
  CANDIDATE_PROPERTIES,
  type CheckrCandidateResponse,
  type CheckrCreateCandidateParams,
} from '@/tools/checkr/types'
import {
  buildCandidateBody,
  CANDIDATE_FIELD_PARAMS,
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrUrl,
  mapCandidate,
  parseCheckrArray,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrCreateCandidateTool: ToolConfig<
  CheckrCreateCandidateParams,
  CheckrCandidateResponse
> = {
  id: 'checkr_create_candidate',
  name: 'Checkr Create Candidate',
  description:
    'Create a candidate to screen. Only email is required when the candidate will be invited; ordering a report directly also needs name, date of birth, and the PII its package requires.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Candidate's email address",
    },
    ...CANDIDATE_FIELD_PARAMS,
    workLocations: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Work locations as a JSON array of { country, state, city } objects (required for candidates outside the US)',
    },
  },

  request: {
    url: () => checkrUrl('/candidates'),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body = buildCandidateBody(params)
      const workLocations = parseCheckrArray(params.workLocations, 'workLocations')
      if (workLocations) body.work_locations = workLocations
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
      description: 'The created candidate',
      properties: CANDIDATE_PROPERTIES,
    },
  },
}
