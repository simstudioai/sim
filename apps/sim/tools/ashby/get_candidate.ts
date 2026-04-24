import type { AshbyGetCandidateParams, AshbyGetCandidateResponse } from '@/tools/ashby/types'
import { CANDIDATE_OUTPUTS, mapCandidate } from '@/tools/ashby/utils'
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
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the candidate to fetch',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.info',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => ({
      id: params.candidateId.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to get candidate')
    }

    return {
      success: true,
      output: mapCandidate(data.results),
    }
  },

  outputs: CANDIDATE_OUTPUTS,
}
