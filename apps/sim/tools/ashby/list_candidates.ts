import type { ToolConfig } from '@/tools/types'
import type { AshbyListCandidatesParams, AshbyListCandidatesResponse } from './types'

export const listCandidatesTool: ToolConfig<
  AshbyListCandidatesParams,
  AshbyListCandidatesResponse
> = {
  id: 'ashby_list_candidates',
  name: 'Ashby List Candidates',
  description: 'Lists all candidates in an Ashby organization with cursor-based pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor from a previous response nextCursor value',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default 100)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/candidate.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list candidates')
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
            createdAt: c.createdAt ?? null,
            updatedAt: c.updatedAt ?? null,
          })
        ),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    candidates: {
      type: 'array',
      description: 'List of candidates',
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
          createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
          updatedAt: { type: 'string', description: 'ISO 8601 last update timestamp' },
        },
      },
    },
    moreDataAvailable: {
      type: 'boolean',
      description: 'Whether more pages of results exist',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for fetching the next page',
      optional: true,
    },
  },
}
