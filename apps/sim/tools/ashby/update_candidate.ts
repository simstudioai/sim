import type { ToolConfig } from '@/tools/types'
import type { AshbyGetCandidateResponse } from './types'

interface AshbyUpdateCandidateParams {
  apiKey: string
  candidateId: string
  name?: string
  email?: string
  emailType?: string
  phoneNumber?: string
  phoneType?: string
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
    emailType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address type: Personal, Work, or Other (default Work)',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated primary phone number',
    },
    phoneType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number type: Personal, Work, or Other (default Work)',
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
        candidateId: params.candidateId,
      }
      if (params.name) body.name = params.name
      if (params.email) {
        body.primaryEmailAddress = {
          value: params.email,
          type: params.emailType || 'Work',
          isPrimary: true,
        }
      }
      if (params.phoneNumber) {
        body.primaryPhoneNumber = {
          value: params.phoneNumber,
          type: params.phoneType || 'Work',
          isPrimary: true,
        }
      }
      if (params.linkedInUrl || params.githubUrl || params.websiteUrl) {
        const socialLinks: Array<{ url: string; type: string }> = []
        if (params.linkedInUrl) socialLinks.push({ url: params.linkedInUrl, type: 'LinkedIn' })
        if (params.githubUrl) socialLinks.push({ url: params.githubUrl, type: 'GitHub' })
        if (params.websiteUrl) socialLinks.push({ url: params.websiteUrl, type: 'Website' })
        body.socialLinks = socialLinks
      }
      if (params.sourceId) body.sourceId = params.sourceId
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to update candidate')
    }

    const r = data.results

    return {
      success: true,
      output: {
        id: r.id ?? null,
        name: r.name ?? null,
        primaryEmailAddress: r.primaryEmailAddress
          ? {
              value: r.primaryEmailAddress.value ?? '',
              type: r.primaryEmailAddress.type ?? 'Other',
              isPrimary: r.primaryEmailAddress.isPrimary ?? true,
            }
          : null,
        primaryPhoneNumber: r.primaryPhoneNumber
          ? {
              value: r.primaryPhoneNumber.value ?? '',
              type: r.primaryPhoneNumber.type ?? 'Other',
              isPrimary: r.primaryPhoneNumber.isPrimary ?? true,
            }
          : null,
        profileUrl: r.profileUrl ?? null,
        position: r.position ?? null,
        company: r.company ?? null,
        linkedInUrl:
          (r.socialLinks ?? []).find((l: { type: string }) => l.type === 'LinkedIn')?.url ?? null,
        githubUrl:
          (r.socialLinks ?? []).find((l: { type: string }) => l.type === 'GitHub')?.url ?? null,
        tags: (r.tags ?? []).map((t: { id: string; title: string }) => ({
          id: t.id,
          title: t.title,
        })),
        applicationIds: r.applicationIds ?? [],
        createdAt: r.createdAt ?? null,
        updatedAt: r.updatedAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Candidate UUID' },
    name: { type: 'string', description: 'Full name' },
    primaryEmailAddress: {
      type: 'object',
      description: 'Primary email contact info',
      optional: true,
      properties: {
        value: { type: 'string', description: 'Email address' },
        type: { type: 'string', description: 'Contact type (Personal, Work, Other)' },
        isPrimary: { type: 'boolean', description: 'Whether this is the primary email' },
      },
    },
    primaryPhoneNumber: {
      type: 'object',
      description: 'Primary phone contact info',
      optional: true,
      properties: {
        value: { type: 'string', description: 'Phone number' },
        type: { type: 'string', description: 'Contact type (Personal, Work, Other)' },
        isPrimary: { type: 'boolean', description: 'Whether this is the primary phone' },
      },
    },
    profileUrl: {
      type: 'string',
      description: 'URL to the candidate Ashby profile',
      optional: true,
    },
    position: { type: 'string', description: 'Current position or title', optional: true },
    company: { type: 'string', description: 'Current company', optional: true },
    linkedInUrl: { type: 'string', description: 'LinkedIn profile URL', optional: true },
    githubUrl: { type: 'string', description: 'GitHub profile URL', optional: true },
    tags: {
      type: 'array',
      description: 'Tags applied to the candidate',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Tag UUID' },
          title: { type: 'string', description: 'Tag title' },
        },
      },
    },
    applicationIds: {
      type: 'array',
      description: 'IDs of associated applications',
      items: { type: 'string', description: 'Application UUID' },
    },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
    updatedAt: { type: 'string', description: 'ISO 8601 last update timestamp' },
  },
}
