import type {
  GreenhouseCandidateSummary,
  GreenhouseListCandidatesParams,
  GreenhouseListCandidatesResponse,
} from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListCandidatesTool: ToolConfig<
  GreenhouseListCandidatesParams,
  GreenhouseListCandidatesResponse
> = {
  id: 'greenhouse_list_candidates',
  name: 'Greenhouse List Candidates',
  description: 'Lists candidates from Greenhouse with optional filtering by date, job, or email',
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
    created_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only candidates created at or after this ISO 8601 timestamp',
    },
    created_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only candidates created before this ISO 8601 timestamp',
    },
    updated_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only candidates updated at or after this ISO 8601 timestamp',
    },
    updated_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only candidates updated before this ISO 8601 timestamp',
    },
    job_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to candidates who applied to this job ID (excludes prospects)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to candidates with this email address',
    },
    candidate_ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated candidate IDs to retrieve (max 50)',
    },
  },

  request: {
    url: (params: GreenhouseListCandidatesParams) => {
      const url = new URL('https://harvest.greenhouse.io/v1/candidates')
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      if (params.created_after) url.searchParams.append('created_after', params.created_after)
      if (params.created_before) url.searchParams.append('created_before', params.created_before)
      if (params.updated_after) url.searchParams.append('updated_after', params.updated_after)
      if (params.updated_before) url.searchParams.append('updated_before', params.updated_before)
      if (params.job_id) url.searchParams.append('job_id', params.job_id)
      if (params.email) url.searchParams.append('email_address', params.email)
      if (params.candidate_ids) url.searchParams.append('candidate_ids', params.candidate_ids)
      return url.toString()
    },
    method: 'GET',
    headers: (params: GreenhouseListCandidatesParams) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GreenhouseListCandidatesResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { candidates: [], count: 0 },
        error: `Greenhouse API error: ${response.status} ${response.statusText}`,
      }
    }

    const data = await response.json()
    const candidates: GreenhouseCandidateSummary[] = (Array.isArray(data) ? data : []).map(
      (c: Record<string, unknown>) => ({
        id: (c.id as number) ?? 0,
        first_name: (c.first_name as string) ?? null,
        last_name: (c.last_name as string) ?? null,
        company: (c.company as string) ?? null,
        title: (c.title as string) ?? null,
        is_private: (c.is_private as boolean) ?? false,
        can_email: (c.can_email as boolean) ?? false,
        email_addresses: (c.email_addresses as Array<{ value: string; type: string }>) ?? [],
        tags: (c.tags as string[]) ?? [],
        application_ids: (c.application_ids as number[]) ?? [],
        created_at: (c.created_at as string) ?? null,
        updated_at: (c.updated_at as string) ?? null,
        last_activity: (c.last_activity as string) ?? null,
      })
    )
    return {
      success: true,
      output: { candidates, count: candidates.length },
    }
  },

  outputs: {
    candidates: {
      type: 'array',
      description: 'List of candidates',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Candidate ID' },
          first_name: { type: 'string', description: 'First name' },
          last_name: { type: 'string', description: 'Last name' },
          company: { type: 'string', description: 'Current employer', optional: true },
          title: { type: 'string', description: 'Current job title', optional: true },
          is_private: { type: 'boolean', description: 'Whether candidate is private' },
          can_email: { type: 'boolean', description: 'Whether candidate can be emailed' },
          email_addresses: {
            type: 'array',
            description: 'Email addresses',
            items: {
              type: 'object',
              properties: {
                value: { type: 'string', description: 'Email address' },
                type: { type: 'string', description: 'Email type (personal, work, other)' },
              },
            },
          },
          tags: {
            type: 'array',
            description: 'Candidate tags',
            items: { type: 'string', description: 'Tag' },
          },
          application_ids: {
            type: 'array',
            description: 'Associated application IDs',
            items: { type: 'number', description: 'Application ID' },
          },
          created_at: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
          updated_at: { type: 'string', description: 'Last updated timestamp (ISO 8601)' },
          last_activity: {
            type: 'string',
            description: 'Last activity timestamp (ISO 8601)',
            optional: true,
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of candidates returned' },
  },
}
