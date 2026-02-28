import type { GreenhouseGetUserParams, GreenhouseGetUserResponse } from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseGetUserTool: ToolConfig<GreenhouseGetUserParams, GreenhouseGetUserResponse> =
  {
    id: 'greenhouse_get_user',
    name: 'Greenhouse Get User',
    description: 'Retrieves a specific Greenhouse user by ID',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Greenhouse Harvest API key',
      },
      userId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the user to retrieve',
      },
    },

    request: {
      url: (params: GreenhouseGetUserParams) =>
        `https://harvest.greenhouse.io/v1/users/${params.userId}`,
      method: 'GET',
      headers: (params: GreenhouseGetUserParams) => ({
        Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response): Promise<GreenhouseGetUserResponse> => {
      if (!response.ok) {
        return {
          success: false,
          output: {
            id: 0,
            name: null,
            first_name: null,
            last_name: null,
            primary_email_address: null,
            disabled: false,
            site_admin: false,
            emails: [],
            employee_id: null,
            linked_candidate_ids: [],
            created_at: null,
            updated_at: null,
          },
          error: `Greenhouse API error: ${response.status} ${response.statusText}`,
        }
      }

      const u = await response.json()
      return {
        success: true,
        output: {
          id: u.id ?? 0,
          name: u.name ?? null,
          first_name: u.first_name ?? null,
          last_name: u.last_name ?? null,
          primary_email_address: u.primary_email_address ?? null,
          disabled: u.disabled ?? false,
          site_admin: u.site_admin ?? false,
          emails: u.emails ?? [],
          employee_id: u.employee_id ?? null,
          linked_candidate_ids: u.linked_candidate_ids ?? [],
          created_at: u.created_at ?? null,
          updated_at: u.updated_at ?? null,
        },
      }
    },

    outputs: {
      id: { type: 'number', description: 'User ID' },
      name: { type: 'string', description: 'Full name' },
      first_name: { type: 'string', description: 'First name' },
      last_name: { type: 'string', description: 'Last name' },
      primary_email_address: { type: 'string', description: 'Primary email address' },
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
  }
