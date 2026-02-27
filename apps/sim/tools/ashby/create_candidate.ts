import type { ToolConfig } from '@/tools/types'
import type { AshbyCreateCandidateParams, AshbyCreateCandidateResponse } from './types'

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
      description: 'Primary phone number for the candidate',
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
      if (params.linkedInUrl || params.githubUrl) {
        const socialLinks: Array<{ url: string; type: string }> = []
        if (params.linkedInUrl) socialLinks.push({ url: params.linkedInUrl, type: 'LinkedIn' })
        if (params.githubUrl) socialLinks.push({ url: params.githubUrl, type: 'GitHub' })
        body.socialLinks = socialLinks
      }
      if (params.sourceId) body.sourceId = params.sourceId
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to create candidate')
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
        createdAt: r.createdAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created candidate UUID' },
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
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
  },
}
