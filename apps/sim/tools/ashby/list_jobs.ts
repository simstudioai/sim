import type { AshbyListJobsParams, AshbyListJobsResponse } from '@/tools/ashby/types'
import { JOB_OUTPUTS, mapJob } from '@/tools/ashby/utils'
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
  },

  request: {
    url: 'https://api.ashbyhq.com/job.list',
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
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list jobs')
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
