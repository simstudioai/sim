import type { RampListUsersParams, RampListUsersResponse } from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListUsersTool: ToolConfig<RampListUsersParams, RampListUsersResponse> = {
  id: 'ramp_list_users',
  name: 'Ramp List Users',
  description: 'List users in the Ramp business with optional filters',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ramp',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Ramp API',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter users by email address',
    },
    departmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter users by department ID',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (between 2 and 100, default 20)',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: the ID of the last entity from the previous page',
    },
  },

  request: {
    url: (params) =>
      buildRampUrl('/users', {
        email: params.email,
        department_id: params.departmentId,
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListUsersResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp users'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        users: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'List of users in the Ramp business',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the user' },
          first_name: { type: 'string', description: 'First name of the user' },
          last_name: { type: 'string', description: 'Last name of the user' },
          email: { type: 'string', description: 'Email address of the user' },
          role: { type: 'string', description: 'Role of the user in the business' },
          status: { type: 'string', description: 'Status of the user (e.g. ACTIVE)' },
          department_id: { type: 'string', description: 'ID of the user department' },
          manager_id: { type: 'string', description: 'ID of the user manager' },
        },
      },
    },
    nextStart: {
      type: 'string',
      description: 'Cursor for the next page of results (null when there are no more pages)',
      optional: true,
    },
  },
}
