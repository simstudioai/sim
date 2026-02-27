import type {
  GreenhouseJobSummary,
  GreenhouseListJobsParams,
  GreenhouseListJobsResponse,
} from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListJobsTool: ToolConfig<
  GreenhouseListJobsParams,
  GreenhouseListJobsResponse
> = {
  id: 'greenhouse_list_jobs',
  name: 'Greenhouse List Jobs',
  description:
    'Lists jobs from Greenhouse with optional filtering by status, department, or office',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Greenhouse Harvest API key',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (1-500, default 100)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by job status (open, closed, draft)',
    },
    created_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only jobs created at or after this ISO 8601 timestamp',
    },
    created_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only jobs created before this ISO 8601 timestamp',
    },
    updated_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only jobs updated at or after this ISO 8601 timestamp',
    },
    updated_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only jobs updated before this ISO 8601 timestamp',
    },
    department_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to jobs in this department ID',
    },
    office_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to jobs in this office ID',
    },
  },

  request: {
    url: (params: GreenhouseListJobsParams) => {
      const url = new URL('https://harvest.greenhouse.io/v1/jobs')
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      if (params.status) url.searchParams.append('status', params.status)
      if (params.created_after) url.searchParams.append('created_after', params.created_after)
      if (params.created_before) url.searchParams.append('created_before', params.created_before)
      if (params.updated_after) url.searchParams.append('updated_after', params.updated_after)
      if (params.updated_before) url.searchParams.append('updated_before', params.updated_before)
      if (params.department_id) url.searchParams.append('department_id', params.department_id)
      if (params.office_id) url.searchParams.append('office_id', params.office_id)
      return url.toString()
    },
    method: 'GET',
    headers: (params: GreenhouseListJobsParams) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GreenhouseListJobsResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { jobs: [], count: 0 },
        error: `Greenhouse API error: ${response.status} ${response.statusText}`,
      }
    }

    const data = await response.json()
    const jobs: GreenhouseJobSummary[] = (Array.isArray(data) ? data : []).map(
      (j: Record<string, unknown>) => ({
        id: (j.id as number) ?? 0,
        name: (j.name as string) ?? null,
        status: (j.status as string) ?? null,
        confidential: (j.confidential as boolean) ?? false,
        departments: (j.departments as Array<{ id: number; name: string }>) ?? [],
        offices: (j.offices as Array<{ id: number; name: string }>) ?? [],
        opened_at: (j.opened_at as string) ?? null,
        closed_at: (j.closed_at as string) ?? null,
        created_at: (j.created_at as string) ?? null,
        updated_at: (j.updated_at as string) ?? null,
      })
    )
    return {
      success: true,
      output: { jobs, count: jobs.length },
    }
  },

  outputs: {
    jobs: {
      type: 'array',
      description: 'List of jobs',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Job ID' },
          name: { type: 'string', description: 'Job title' },
          status: { type: 'string', description: 'Job status (open, closed, draft)' },
          confidential: { type: 'boolean', description: 'Whether the job is confidential' },
          departments: {
            type: 'array',
            description: 'Associated departments',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Department ID' },
                name: { type: 'string', description: 'Department name' },
              },
            },
          },
          offices: {
            type: 'array',
            description: 'Associated offices',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Office ID' },
                name: { type: 'string', description: 'Office name' },
              },
            },
          },
          opened_at: {
            type: 'string',
            description: 'Date job was opened (ISO 8601)',
            optional: true,
          },
          closed_at: {
            type: 'string',
            description: 'Date job was closed (ISO 8601)',
            optional: true,
          },
          created_at: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
          updated_at: { type: 'string', description: 'Last updated timestamp (ISO 8601)' },
        },
      },
    },
    count: { type: 'number', description: 'Number of jobs returned' },
  },
}
