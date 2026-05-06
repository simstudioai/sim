import type { AshbyListJobsParams, AshbyListJobsResponse } from '@/tools/ashby/types'
import { ashbyAuthHeaders, ashbyErrorMessage, JOB_OUTPUTS, mapJob } from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

export const listJobsTool: ToolConfig<AshbyListJobsParams, AshbyListJobsResponse> = {
  id: 'ashby_list_jobs',
  name: 'Ashby List Jobs',
  description:
    'Lists all jobs in an Ashby organization. By default returns Open, Closed, and Archived jobs. Specify status to filter.',
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
      description: 'Filter by job status: Open, Closed, Archived, or Draft',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return jobs created after this ISO 8601 timestamp (e.g. 2024-01-01T00:00:00Z)',
    },
    openedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return jobs opened after this ISO 8601 timestamp',
    },
    openedBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return jobs opened before this ISO 8601 timestamp',
    },
    closedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return jobs closed after this ISO 8601 timestamp',
    },
    closedBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return jobs closed before this ISO 8601 timestamp',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/job.list',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { expand: ['openings', 'location'] }
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      if (params.status) body.status = [params.status]
      const isoToMs = (iso: string): number | null => {
        const ms = new Date(iso).getTime()
        return Number.isNaN(ms) ? null : ms
      }
      if (params.createdAfter) {
        const ms = isoToMs(params.createdAfter)
        if (ms !== null) body.createdAfter = ms
      }
      if (params.openedAfter) {
        const ms = isoToMs(params.openedAfter)
        if (ms !== null) body.openedAfter = ms
      }
      if (params.openedBefore) {
        const ms = isoToMs(params.openedBefore)
        if (ms !== null) body.openedBefore = ms
      }
      if (params.closedAfter) {
        const ms = isoToMs(params.closedAfter)
        if (ms !== null) body.closedAfter = ms
      }
      if (params.closedBefore) {
        const ms = isoToMs(params.closedBefore)
        if (ms !== null) body.closedBefore = ms
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to list jobs'))
    }

    return {
      success: true,
      output: {
        jobs: (data.results ?? []).map(mapJob),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    jobs: {
      type: 'array',
      description: 'List of jobs',
      items: {
        type: 'object',
        properties: JOB_OUTPUTS,
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
