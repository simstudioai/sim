import type { AshbyCandidate } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  CANDIDATE_OUTPUTS,
  mapCandidate,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyAnonymizeCandidateParams {
  apiKey: string
  candidateId: string
}

interface AshbyAnonymizeCandidateResponse extends ToolResponse {
  output: AshbyCandidate
}

export const anonymizeCandidateTool: ToolConfig<
  AshbyAnonymizeCandidateParams,
  AshbyAnonymizeCandidateResponse
> = {
  id: 'ashby_anonymize_candidate',
  name: 'Ashby Anonymize Candidate',
  description:
    'Strips personally identifiable information from a candidate in Ashby. This does not delete the candidate - the record and its applications remain, with the PII removed. Ashby exposes no candidate deletion endpoint; true deletion is UI-only, restricted by role, and limited to a 10-day window. Requires the candidatesWrite permission.',
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
      description: 'UUID of the candidate to anonymize',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.anonymize',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => ({ candidateId: params.candidateId.trim() }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to anonymize candidate'))
    }

    return {
      success: true,
      output: mapCandidate(data.results),
    }
  },

  outputs: CANDIDATE_OUTPUTS,
}
