import type { ToolConfig } from '@/tools/types'
import type { AshbyGetCandidateParams, AshbyGetCandidateResponse } from './types'

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
      candidateId: params.candidateId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to get candidate')
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
