import type { RampListUsersParams, RampListUsersResponse } from '@/tools/ramp/types'
import { RAMP_USER_PROPERTIES } from '@/tools/ramp/types'
import {
  appendRampPagination,
  buildRampHeaders,
  getRampPagination,
  parseRampResponse,
  projectUser,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListUsersTool: ToolConfig<RampListUsersParams, RampListUsersResponse> = {
  id: 'ramp_list_users',
  name: 'Ramp List Users',
  description: 'List users in one page in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'filter by email',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter only for users with the given status. Defaults to returning all active and inactive users, but not suspended users',
    },
    department_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'filter by department',
    },
    entity_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'filter by business entity',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Next cursor from the previous response',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page, from 2 to 100 (default 20)',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      appendRampPagination(query, params)
      if (params.email) query.set('email', params.email.trim())
      if (params.status) query.set('status', params.status.trim())
      if (params.department_id) query.set('department_id', params.department_id.trim())
      if (params.entity_id) query.set('entity_id', params.entity_id.trim())
      return `https://api.ramp.com/developer/v1/users?${query}`
    },
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    if (!Array.isArray(data.data)) throw new Error('Ramp returned an invalid list response')
    if (data.data.length > 100) throw new Error('Ramp returned more than 100 results in one page')
    return {
      success: true,
      output: { users: data.data.map(projectUser), ...getRampPagination(data) },
    }
  },
  outputs: {
    users: {
      type: 'array',
      description: 'One page of users',
      items: { type: 'object', properties: RAMP_USER_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Pass this cursor as start to fetch the next page',
      nullable: true,
    },
    nextPageUrl: {
      type: 'string',
      description: 'Ramp URL for the next page, or null on the last page',
      nullable: true,
    },
  },
}
