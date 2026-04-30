import type { AshbyGetCandidateResponse } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  CANDIDATE_OUTPUTS,
  mapCandidate,
} from '@/tools/ashby/utils'
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
  alternateEmail?: string
  sourceId?: string
  creditedToUserId?: string
  createdAt?: string
  sendNotifications?: boolean
  socialLinks?: Array<{ type: string; url: string }>
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
    alternateEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'An additional email address to add to the candidate',
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
        'Backdated creation timestamp in ISO 8601. Only updatable if originally backdated.',
    },
    sendNotifications: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to send a notification when the source is updated (default true)',
    },
    socialLinks: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of social link objects to set on the candidate, e.g. [{"type":"LinkedIn","url":"https://..."}]. Replaces existing social links.',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.update',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
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
      if (params.alternateEmail) body.alternateEmail = params.alternateEmail
      if (params.sourceId) body.sourceId = params.sourceId.trim()
      if (params.creditedToUserId) body.creditedToUserId = params.creditedToUserId.trim()
      if (params.createdAt) body.createdAt = params.createdAt
      if (params.sendNotifications !== undefined) body.sendNotifications = params.sendNotifications
      if (Array.isArray(params.socialLinks) && params.socialLinks.length > 0)
        body.socialLinks = params.socialLinks
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to update candidate'))
    }

    return {
      success: true,
      output: mapCandidate(data.results),
    }
  },

  outputs: CANDIDATE_OUTPUTS,
}
