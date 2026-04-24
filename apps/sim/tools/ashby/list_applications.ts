import type {
  AshbyListApplicationsParams,
  AshbyListApplicationsResponse,
} from '@/tools/ashby/types'
import { APPLICATION_OUTPUTS, mapApplication } from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

export const listApplicationsTool: ToolConfig<
  AshbyListApplicationsParams,
  AshbyListApplicationsResponse
> = {
  id: 'ashby_list_applications',
  name: 'Ashby List Applications',
  description:
    'Lists all applications in an Ashby organization with pagination and optional filters for status, job, and creation date.',
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
      if (params.status) body.status = params.status
      if (params.jobId) body.jobId = params.jobId.trim()
      if (params.createdAfter) {
        const ms = new Date(params.createdAfter).getTime()
        if (!Number.isNaN(ms)) body.createdAfter = ms
      }
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
        applications: (data.results ?? []).map(mapApplication),
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
        properties: APPLICATION_OUTPUTS,
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
