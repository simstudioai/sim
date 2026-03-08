import type { DatabricksListJobsParams, DatabricksListJobsResponse } from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const listJobsTool: ToolConfig<DatabricksListJobsParams, DatabricksListJobsResponse> = {
  id: 'databricks_list_jobs',
  name: 'Databricks List Jobs',
  description: 'List all jobs in a Databricks workspace with optional filtering by name.',
  version: '1.0.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Databricks workspace host (e.g., dbc-abc123.cloud.databricks.com)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Databricks Personal Access Token',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of jobs to return (range 1-100, default 20)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter jobs by exact name (case-insensitive)',
    },
    expandTasks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include task and cluster details in the response (max 100 elements)',
    },
  },

  request: {
    url: (params) => {
      const host = params.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const url = new URL(`https://${host}/api/2.1/jobs/list`)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.offset) url.searchParams.set('offset', String(params.offset))
      if (params.name) url.searchParams.set('name', params.name)
      if (params.expandTasks) url.searchParams.set('expand_tasks', 'true')
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error?.message || 'Failed to list jobs')
    }

    const jobs = (data.jobs ?? []).map(
      (job: {
        job_id?: number
        settings?: { name?: string; max_concurrent_runs?: number; format?: string }
        created_time?: number
        creator_user_name?: string
      }) => ({
        jobId: job.job_id ?? 0,
        name: job.settings?.name ?? '',
        createdTime: job.created_time ?? 0,
        creatorUserName: job.creator_user_name ?? '',
        maxConcurrentRuns: job.settings?.max_concurrent_runs ?? 1,
        format: job.settings?.format ?? '',
      })
    )

    return {
      success: true,
      output: {
        jobs,
        hasMore: data.has_more ?? false,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    jobs: {
      type: 'array',
      description: 'List of jobs in the workspace',
      items: {
        type: 'object',
        properties: {
          jobId: { type: 'number', description: 'Unique job identifier' },
          name: { type: 'string', description: 'Job name' },
          createdTime: { type: 'number', description: 'Job creation timestamp (epoch ms)' },
          creatorUserName: { type: 'string', description: 'Email of the job creator' },
          maxConcurrentRuns: { type: 'number', description: 'Maximum number of concurrent runs' },
          format: { type: 'string', description: 'Job format (SINGLE_TASK or MULTI_TASK)' },
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more jobs are available for pagination',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
