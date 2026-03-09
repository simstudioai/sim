import type {
  GreenhouseListUsersParams,
  GreenhouseListUsersResponse,
  GreenhouseUser,
} from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListUsersTool: ToolConfig<
  GreenhouseListUsersParams,
  GreenhouseListUsersResponse
> = {
  id: 'greenhouse_list_users',
  name: 'Greenhouse List Users',
  description:
    'Lists Greenhouse users (recruiters, hiring managers, admins) with optional filtering',
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
      description: 'Return only users created at or after this ISO 8601 timestamp',
    },
    created_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only users created before this ISO 8601 timestamp',
    },
    updated_after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only users updated at or after this ISO 8601 timestamp',
    },
    updated_before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only users updated before this ISO 8601 timestamp',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by email address',
    },
  },

  request: {
    url: (params: GreenhouseListUsersParams) => {
      const url = new URL('https://harvest.greenhouse.io/v1/users')
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      if (params.created_after) url.searchParams.append('created_after', params.created_after)
      if (params.created_before) url.searchParams.append('created_before', params.created_before)
      if (params.updated_after) url.searchParams.append('updated_after', params.updated_after)
      if (params.updated_before) url.searchParams.append('updated_before', params.updated_before)
      if (params.email) url.searchParams.append('email', params.email)
      return url.toString()
    },
    method: 'GET',
    headers: (params: GreenhouseListUsersParams) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GreenhouseListUsersResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { users: [], count: 0 },
        error: `Greenhouse API error: ${response.status} ${response.statusText}`,
      }
    }

    const data = await response.json()
    const users: GreenhouseUser[] = (Array.isArray(data) ? data : []).map(
      (u: Record<string, unknown>) => ({
        id: (u.id as number) ?? 0,
        name: (u.name as string) ?? null,
        first_name: (u.first_name as string) ?? null,
        last_name: (u.last_name as string) ?? null,
        primary_email_address: (u.primary_email_address as string) ?? null,
        disabled: (u.disabled as boolean) ?? false,
        site_admin: (u.site_admin as boolean) ?? false,
        emails: (u.emails as string[]) ?? [],
        employee_id: (u.employee_id as string) ?? null,
        linked_candidate_ids: (u.linked_candidate_ids as number[]) ?? [],
        created_at: (u.created_at as string) ?? null,
        updated_at: (u.updated_at as string) ?? null,
      })
    )
    return {
      success: true,
      output: { users, count: users.length },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'List of Greenhouse users',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'User ID' },
          name: { type: 'string', description: 'Full name' },
          first_name: { type: 'string', description: 'First name' },
          last_name: { type: 'string', description: 'Last name' },
          primary_email_address: { type: 'string', description: 'Primary email' },
          disabled: { type: 'boolean', description: 'Whether the user is disabled' },
          site_admin: { type: 'boolean', description: 'Whether the user is a site admin' },
          emails: {
            type: 'array',
            description: 'All email addresses',
            items: { type: 'string', description: 'Email address' },
          },
          employee_id: { type: 'string', description: 'Employee ID', optional: true },
          linked_candidate_ids: {
            type: 'array',
            description: 'IDs of candidates linked to this user',
            items: { type: 'number', description: 'Candidate ID' },
          },
          created_at: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
          updated_at: { type: 'string', description: 'Last updated timestamp (ISO 8601)' },
        },
      },
    },
    count: { type: 'number', description: 'Number of users returned' },
  },
}
