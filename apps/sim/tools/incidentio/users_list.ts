import {
  INCIDENTIO_PAGINATION_OUTPUT_PROPERTIES,
  type IncidentioUsersListParams,
  type IncidentioUsersListResponse,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const usersListTool: ToolConfig<IncidentioUsersListParams, IncidentioUsersListResponse> = {
  id: 'incidentio_users_list',
  name: 'Incident.io Users List',
  description:
    'List all users in your Incident.io workspace. Returns user details including id, name, email, and role.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Incident.io API Key',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return per page (e.g., 10, 25, 50). Default: 25',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor to fetch the next page of results',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v2/users')

      if (params.page_size) {
        url.searchParams.append('page_size', params.page_size.toString())
      }

      if (params.after) {
        url.searchParams.append('after', params.after)
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        users: data.users.map((user: any) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        })),
        pagination_meta: data.pagination_meta
          ? {
              after: data.pagination_meta.after,
              page_size: data.pagination_meta.page_size,
              total_record_count: data.pagination_meta.total_record_count,
            }
          : undefined,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'List of users in the workspace',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the user' },
          name: { type: 'string', description: 'Full name of the user' },
          email: { type: 'string', description: 'Email address of the user' },
          role: { type: 'string', description: 'Role of the user in the workspace' },
        },
      },
    },
    pagination_meta: {
      type: 'object',
      description: 'Pagination metadata',
      optional: true,
      properties: INCIDENTIO_PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
