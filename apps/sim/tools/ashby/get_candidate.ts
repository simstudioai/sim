import type { AshbyGetCandidateParams, AshbyGetCandidateResponse } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  CANDIDATE_OUTPUTS,
  mapCandidate,
} from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

export const getCandidateTool: ToolConfig<AshbyGetCandidateParams, AshbyGetCandidateResponse> = {
  id: 'ashby_get_candidate',
  name: 'Ashby Get Candidate',
  description: 'Retrieves full details about a single candidate by their ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    candidateId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The UUID of the candidate to fetch',
    },
    externalMappingId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External mapping ID to use instead of the Ashby candidate UUID',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.info',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const candidateId = params.candidateId?.trim()
      const externalMappingId = params.externalMappingId?.trim()
      if (!candidateId && !externalMappingId)
        throw new Error('Provide candidateId or externalMappingId.')
      return {
        ...(candidateId ? { id: candidateId } : {}),
        ...(externalMappingId ? { externalMappingId } : {}),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to get candidate'))
    }

    return {
      success: true,
      output: mapCandidate(data.results),
    }
  },

  outputs: CANDIDATE_OUTPUTS,
}
