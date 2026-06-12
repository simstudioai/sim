import type { BrexListUsersParams, BrexListUsersResponse } from '@/tools/brex/types'
import { BREX_USER_PROPERTIES } from '@/tools/brex/types'
import {
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListUsersTool: ToolConfig<BrexListUsersParams, BrexListUsersResponse> = {
  id: 'brex_list_users',
  name: 'Brex List Users',
  description: 'List users in the Brex account, optionally filtered by email',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter users by exact email address',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of users to return (default 100, max 1000)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.email) query.append('email', params.email.trim())
      appendBrexPagination(query, params)
      const queryString = query.toString()
      return queryString ? `${BREX_API_BASE}/v2/users?${queryString}` : `${BREX_API_BASE}/v2/users`
    },
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        items: data.items ?? [],
        nextCursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Users in the Brex account',
      items: { type: 'json', properties: BREX_USER_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
