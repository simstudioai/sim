import type {
  AshbySearchCandidatesParams,
  AshbySearchCandidatesResponse,
} from '@/tools/ashby/types'
import { CANDIDATE_OUTPUTS, mapCandidate } from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

export const searchCandidatesTool: ToolConfig<
  AshbySearchCandidatesParams,
  AshbySearchCandidatesResponse
> = {
  id: 'ashby_search_candidates',
  name: 'Ashby Search Candidates',
  description:
    'Searches for candidates by name and/or email with AND logic. Results are limited to 100 matches. Use candidate.list for full pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Candidate name to search for (combined with email using AND logic)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Candidate email to search for (combined with name using AND logic)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.search',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.email) body.email = params.email
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to search candidates')
    }

    return {
      success: true,
      output: {
        candidates: (data.results ?? []).map(mapCandidate),
      },
    }
  },

  outputs: {
    candidates: {
      type: 'array',
      description: 'Matching candidates (max 100 results)',
      items: {
        type: 'object',
        properties: CANDIDATE_OUTPUTS,
      },
    },
  },
}
