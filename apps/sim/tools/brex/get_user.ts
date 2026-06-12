import type { BrexGetUserParams, BrexGetUserResponse } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexGetUserTool: ToolConfig<BrexGetUserParams, BrexGetUserResponse> = {
  id: 'brex_get_user',
  name: 'Brex Get User',
  description: 'Get a Brex user by their ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the user to fetch',
    },
  },

  request: {
    url: (params) => `${BREX_API_BASE}/v2/users/${encodeURIComponent(params.userId.trim())}`,
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        id: data.id ?? '',
        firstName: data.first_name ?? '',
        lastName: data.last_name ?? '',
        email: data.email ?? '',
        status: data.status ?? null,
        managerId: data.manager_id ?? null,
        departmentId: data.department_id ?? null,
        locationId: data.location_id ?? null,
        titleId: data.title_id ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique user ID' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    email: { type: 'string', description: 'Email address' },
    status: {
      type: 'string',
      description:
        'User status (INVITED, ACTIVE, CLOSED, DISABLED, DELETED, PENDING_ACTIVATION, INACTIVE, ARCHIVED)',
      optional: true,
    },
    managerId: { type: 'string', description: 'ID of the manager', optional: true },
    departmentId: { type: 'string', description: 'Department ID', optional: true },
    locationId: { type: 'string', description: 'Location ID', optional: true },
    titleId: { type: 'string', description: 'Title ID', optional: true },
  },
}
