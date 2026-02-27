import type { ToolConfig } from '@/tools/types'
import type { AshbyListApplicationsParams, AshbyListApplicationsResponse } from './types'

export const listApplicationsTool: ToolConfig<
  AshbyListApplicationsParams,
  AshbyListApplicationsResponse
> = {
  id: 'ashby_list_applications',
  name: 'Ashby List Applications',
  description:
    'Lists all applications in an Ashby organization with pagination and optional filters for status, job, candidate, and creation date.',
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
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by application status: Active, Hired, Archived, or Lead',
    },
    jobId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter applications by a specific job UUID',
    },
    candidateId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter applications by a specific candidate UUID',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter to applications created after this ISO 8601 timestamp (e.g. 2024-01-01T00:00:00Z)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/application.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      if (params.status) body.status = [params.status]
      if (params.jobId) body.jobId = params.jobId
      if (params.candidateId) body.candidateId = params.candidateId
      if (params.createdAfter) body.createdAfter = params.createdAfter
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list applications')
    }

    return {
      success: true,
      output: {
        applications: (data.results ?? []).map(
          (
            a: Record<string, unknown> & {
              candidate?: { id?: string; name?: string }
              job?: { id?: string; title?: string }
              currentInterviewStage?: { id?: string; title?: string; type?: string } | null
              source?: { id?: string; title?: string } | null
            }
          ) => ({
            id: a.id ?? null,
            status: a.status ?? null,
            candidate: {
              id: a.candidate?.id ?? null,
              name: a.candidate?.name ?? null,
            },
            job: {
              id: a.job?.id ?? null,
              title: a.job?.title ?? null,
            },
            currentInterviewStage: a.currentInterviewStage
              ? {
                  id: a.currentInterviewStage.id ?? null,
                  title: a.currentInterviewStage.title ?? null,
                  type: a.currentInterviewStage.type ?? null,
                }
              : null,
            source: a.source
              ? {
                  id: a.source.id ?? null,
                  title: a.source.title ?? null,
                }
              : null,
            createdAt: a.createdAt ?? null,
            updatedAt: a.updatedAt ?? null,
          })
        ),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    applications: {
      type: 'array',
      description: 'List of applications',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Application UUID' },
          status: {
            type: 'string',
            description: 'Application status (Active, Hired, Archived, Lead)',
          },
          candidate: {
            type: 'object',
            description: 'Associated candidate',
            properties: {
              id: { type: 'string', description: 'Candidate UUID' },
              name: { type: 'string', description: 'Candidate name' },
            },
          },
          job: {
            type: 'object',
            description: 'Associated job',
            properties: {
              id: { type: 'string', description: 'Job UUID' },
              title: { type: 'string', description: 'Job title' },
            },
          },
          currentInterviewStage: {
            type: 'object',
            description: 'Current interview stage',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Stage UUID' },
              title: { type: 'string', description: 'Stage title' },
              type: { type: 'string', description: 'Stage type' },
            },
          },
          source: {
            type: 'object',
            description: 'Application source',
            optional: true,
            properties: {
              id: { type: 'string', description: 'Source UUID' },
              title: { type: 'string', description: 'Source title' },
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
