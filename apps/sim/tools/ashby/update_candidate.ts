import type { AshbyGetCandidateResponse } from '@/tools/ashby/types'
import { CANDIDATE_OUTPUTS, mapCandidate } from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

interface AshbyUpdateCandidateParams {
  apiKey: string
  candidateId: string
  name?: string
  email?: string
  phoneNumber?: string
  linkedInUrl?: string
  githubUrl?: string
  websiteUrl?: string
  sourceId?: string
}

export const updateCandidateTool: ToolConfig<
  AshbyUpdateCandidateParams,
  AshbyGetCandidateResponse
> = {
  id: 'ashby_update_candidate',
  name: 'Ashby Update Candidate',
  description: 'Updates an existing candidate record in Ashby. Only provided fields are changed.',
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
      description: 'The UUID of the candidate to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated full name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated primary email address',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated primary phone number',
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
    websiteUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Personal website URL',
    },
    sourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the source to attribute the candidate to',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.update',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        candidateId: params.candidateId.trim(),
      }
      if (params.name) body.name = params.name
      if (params.email) body.email = params.email
      if (params.phoneNumber) body.phoneNumber = params.phoneNumber
      if (params.linkedInUrl) body.linkedInUrl = params.linkedInUrl
      if (params.githubUrl) body.githubUrl = params.githubUrl
      if (params.websiteUrl) body.websiteUrl = params.websiteUrl
      if (params.sourceId) body.sourceId = params.sourceId.trim()
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to update candidate')
    }

    return {
      success: true,
      output: mapCandidate(data.results),
    }
  },

  outputs: CANDIDATE_OUTPUTS,
}
