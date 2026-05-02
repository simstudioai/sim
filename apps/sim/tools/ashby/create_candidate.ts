import type { AshbyCreateCandidateParams, AshbyCreateCandidateResponse } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  CANDIDATE_OUTPUTS,
  mapCandidate,
} from '@/tools/ashby/utils'
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
    website: {
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
    creditedToUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of the Ashby user to credit with sourcing this candidate',
    },
    createdAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Backdated creation timestamp in ISO 8601 (e.g. 2024-01-01T00:00:00Z). Defaults to now.',
    },
    alternateEmailAddresses: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of additional email address strings to add to the candidate, e.g. ["a@x.com","b@y.com"]',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.create',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
      }
      if (params.email) body.email = params.email
      if (params.phoneNumber) body.phoneNumber = params.phoneNumber
      if (params.linkedInUrl) body.linkedInUrl = params.linkedInUrl
      if (params.githubUrl) body.githubUrl = params.githubUrl
      if (params.website) body.website = params.website
      if (params.sourceId) body.sourceId = params.sourceId.trim()
      if (params.creditedToUserId) body.creditedToUserId = params.creditedToUserId.trim()
      if (params.createdAt) body.createdAt = params.createdAt
      if (
        Array.isArray(params.alternateEmailAddresses) &&
        params.alternateEmailAddresses.length > 0
      )
        body.alternateEmailAddresses = params.alternateEmailAddresses
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to create candidate'))
    }

    return {
      success: true,
      output: mapCandidate(data.results),
    }
  },

  outputs: CANDIDATE_OUTPUTS,
}
