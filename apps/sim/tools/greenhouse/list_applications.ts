import type {
  GreenhouseApplicationSummary,
  GreenhouseListApplicationsParams,
  GreenhouseListApplicationsResponse,
} from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListApplicationsTool: ToolConfig<
  GreenhouseListApplicationsParams,
  GreenhouseListApplicationsResponse
> = {
  id: 'greenhouse_list_applications',
  name: 'Greenhouse List Applications',
  description: 'Lists applications from Greenhouse with optional filtering by job, status, or date',
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
    job_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter applications by job ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status (active, converted, hired, rejected)',
    },
    created_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only applications created at or after this ISO 8601 timestamp',
    },
    created_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only applications created before this ISO 8601 timestamp',
    },
    last_activity_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only applications with activity at or after this ISO 8601 timestamp',
    },
  },

  request: {
    url: (params: GreenhouseListApplicationsParams) => {
      const url = new URL('https://harvest.greenhouse.io/v1/applications')
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      if (params.job_id) url.searchParams.append('job_id', params.job_id)
      if (params.status) url.searchParams.append('status', params.status)
      if (params.created_after) url.searchParams.append('created_after', params.created_after)
      if (params.created_before) url.searchParams.append('created_before', params.created_before)
      if (params.last_activity_after)
        url.searchParams.append('last_activity_after', params.last_activity_after)
      return url.toString()
    },
    method: 'GET',
    headers: (params: GreenhouseListApplicationsParams) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GreenhouseListApplicationsResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { applications: [], count: 0 },
        error: `Greenhouse API error: ${response.status} ${response.statusText}`,
      }
    }

    const data = await response.json()
    const applications: GreenhouseApplicationSummary[] = (Array.isArray(data) ? data : []).map(
      (a: Record<string, unknown>) => ({
        id: (a.id as number) ?? 0,
        candidate_id: (a.candidate_id as number) ?? null,
        prospect: (a.prospect as boolean) ?? false,
        status: (a.status as string) ?? null,
        current_stage: (a.current_stage as { id: number; name: string }) ?? null,
        jobs: (a.jobs as Array<{ id: number; name: string }>) ?? [],
        applied_at: (a.applied_at as string) ?? null,
        rejected_at: (a.rejected_at as string) ?? null,
        last_activity_at: (a.last_activity_at as string) ?? null,
      })
    )
    return {
      success: true,
      output: { applications, count: applications.length },
    }
  },

  outputs: {
    applications: {
      type: 'array',
      description: 'List of applications',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Application ID' },
          candidate_id: { type: 'number', description: 'Associated candidate ID' },
          prospect: { type: 'boolean', description: 'Whether this is a prospect application' },
          status: { type: 'string', description: 'Status (active, converted, hired, rejected)' },
          current_stage: {
            type: 'object',
            description: 'Current interview stage',
            optional: true,
            properties: {
              id: { type: 'number', description: 'Stage ID' },
              name: { type: 'string', description: 'Stage name' },
            },
          },
          jobs: {
            type: 'array',
            description: 'Associated jobs',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Job ID' },
                name: { type: 'string', description: 'Job name' },
              },
            },
          },
          applied_at: { type: 'string', description: 'Application date (ISO 8601)' },
          rejected_at: { type: 'string', description: 'Rejection date (ISO 8601)', optional: true },
          last_activity_at: { type: 'string', description: 'Last activity date (ISO 8601)' },
        },
      },
    },
    count: { type: 'number', description: 'Number of applications returned' },
  },
}
