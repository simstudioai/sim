import type { AshbyGetCandidateResponse } from '@/tools/ashby/types'
import {
  ASHBY_ON_BEHALF_OF_PARAM,
  ashbyAuthHeaders,
  ashbyErrorMessage,
  ashbyIsoDateTime,
  CANDIDATE_OUTPUTS,
  mapCandidate,
} from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

interface AshbyUpdateCandidateParams {
  apiKey: string
  onBehalfOfUserId?: string
  candidateId: string
  name?: string | null
  email?: string | null
  phoneNumber?: string | null
  linkedInUrl?: string | null
  githubUrl?: string | null
  websiteUrl?: string | null
  alternateEmail?: string | null
  sourceId?: string
  creditedToUserId?: string
  clearSource?: boolean
  clearCreditedToUser?: boolean
  location?: { city?: string | null; region?: string | null; country?: string | null } | null
  createdAt?: string | null
  sendNotifications?: boolean | null
  socialLinks?: Array<{ type: string; url: string }> | null
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
    ...ASHBY_ON_BEHALF_OF_PARAM,
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
      description: 'Updated full name, or null',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated primary email address, or null',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated primary phone number, or null',
    },
    linkedInUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL, or null',
    },
    githubUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'GitHub profile URL, or null',
    },
    websiteUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Personal website URL, or null',
    },
    alternateEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'An additional email address to add to the candidate, or null',
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
    clearSource: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Explicitly clear the candidate source; mutually exclusive with sourceId',
    },
    clearCreditedToUser: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Explicitly clear the credited Ashby user; mutually exclusive with creditedToUserId',
    },
    location: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Candidate location object with optional city, region, and country; the object and its fields accept null',
    },
    createdAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Backdated creation timestamp in ISO 8601, or null. Only updatable if originally backdated.',
    },
    sendNotifications: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to send a notification when the source is updated (default true), or null',
    },
    socialLinks: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of social link objects to set on the candidate, e.g. [{"type":"LinkedIn","url":"https://..."}]. Replaces existing links; pass [] to clear them. Null is also accepted. Mutually exclusive with linkedInUrl, githubUrl, and websiteUrl.',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.update',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey, params.onBehalfOfUserId),
    body: (params) => {
      const body: Record<string, unknown> = {
        candidateId: params.candidateId.trim(),
      }
      if (params.name !== undefined) body.name = params.name
      if (params.email !== undefined) body.email = params.email
      if (params.phoneNumber !== undefined) body.phoneNumber = params.phoneNumber
      const hasIndividualSocialLink =
        params.linkedInUrl !== undefined ||
        params.githubUrl !== undefined ||
        params.websiteUrl !== undefined
      if (params.socialLinks !== undefined && hasIndividualSocialLink) {
        throw new Error(
          'socialLinks is mutually exclusive with linkedInUrl, githubUrl, and websiteUrl because Ashby ignores the individual fields when socialLinks is provided.'
        )
      }
      if (params.linkedInUrl !== undefined) body.linkedInUrl = params.linkedInUrl
      if (params.githubUrl !== undefined) body.githubUrl = params.githubUrl
      if (params.websiteUrl !== undefined) body.websiteUrl = params.websiteUrl
      if (params.alternateEmail !== undefined) body.alternateEmail = params.alternateEmail
      if (params.clearSource && params.sourceId)
        throw new Error('sourceId and clearSource are mutually exclusive.')
      if (params.clearCreditedToUser && params.creditedToUserId)
        throw new Error('creditedToUserId and clearCreditedToUser are mutually exclusive.')
      if (params.clearSource) body.sourceId = null
      else if (params.sourceId) body.sourceId = params.sourceId.trim()
      if (params.clearCreditedToUser) body.creditedToUserId = null
      else if (params.creditedToUserId) body.creditedToUserId = params.creditedToUserId.trim()
      if (
        params.location === null ||
        (typeof params.location === 'object' && !Array.isArray(params.location))
      ) {
        body.location = params.location
      }
      if (params.createdAt === null) body.createdAt = null
      else if (params.createdAt !== undefined) {
        body.createdAt = ashbyIsoDateTime(params.createdAt, 'createdAt')
      }
      if (params.sendNotifications !== undefined) body.sendNotifications = params.sendNotifications
      if (params.socialLinks === null || Array.isArray(params.socialLinks)) {
        body.socialLinks = params.socialLinks
      }
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
