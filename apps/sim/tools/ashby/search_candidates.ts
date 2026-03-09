import type { ToolConfig } from '@/tools/types'
import type { AshbySearchCandidatesParams, AshbySearchCandidatesResponse } from './types'

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
        candidates: (data.results ?? []).map(
          (
            c: Record<string, unknown> & {
              primaryEmailAddress?: { value?: string; type?: string; isPrimary?: boolean }
              primaryPhoneNumber?: { value?: string; type?: string; isPrimary?: boolean }
            }
          ) => ({
            id: c.id ?? null,
            name: c.name ?? null,
            primaryEmailAddress: c.primaryEmailAddress
              ? {
                  value: c.primaryEmailAddress.value ?? '',
                  type: c.primaryEmailAddress.type ?? 'Other',
                  isPrimary: c.primaryEmailAddress.isPrimary ?? true,
                }
              : null,
            primaryPhoneNumber: c.primaryPhoneNumber
              ? {
                  value: c.primaryPhoneNumber.value ?? '',
                  type: c.primaryPhoneNumber.type ?? 'Other',
                  isPrimary: c.primaryPhoneNumber.isPrimary ?? true,
                }
              : null,
          })
        ),
      },
    }
  },

  outputs: {
    candidates: {
      type: 'array',
      description: 'Matching candidates (max 100 results)',
      items: {
        type: 'object',
        properties: {
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
        },
      },
    },
  },
}
