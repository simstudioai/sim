import type { AshbyCreateCandidateParams, AshbyCreateCandidateResponse } from '@/tools/ashby/types'
import { CANDIDATE_OUTPUTS, mapCandidate } from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

export const createCandidateTool: ToolConfig<
  AshbyCreateCandidateParams,
  AshbyCreateCandidateResponse
> = {
  id: 'ashby_create_candidate',
  name: 'Ashby Create Candidate',
  description: 'Creates a new candidate record in Ashby.',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'The candidate full name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary email address for the candidate',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Primary phone number for the candidate',
    },
    linkedInUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL',
    },
    githubUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'GitHub profile URL',
    },
    sourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the source to attribute the candidate to',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.create',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
      }
      if (params.email) body.email = params.email
      if (params.phoneNumber) body.phoneNumber = params.phoneNumber
      if (params.linkedInUrl) body.linkedInUrl = params.linkedInUrl
      if (params.githubUrl) body.githubUrl = params.githubUrl
      if (params.sourceId) body.sourceId = params.sourceId.trim()
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to create candidate')
    }

    return {
      success: true,
      output: mapCandidate(data.results),
    }
  },

  outputs: CANDIDATE_OUTPUTS,
}
