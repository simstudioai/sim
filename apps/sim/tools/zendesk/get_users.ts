import type { ToolConfig } from '@/tools/types'
import {
  appendCursorPaginationParams,
  buildZendeskUrl,
  extractCursorPagingInfo,
  handleZendeskError,
  METADATA_OUTPUT,
  PAGING_OUTPUT,
  USERS_ARRAY_OUTPUT,
} from '@/tools/zendesk/types'

export interface ZendeskGetUsersParams {
  email: string
  apiToken: string
  subdomain: string
  role?: string
  permissionSet?: string
  perPage?: string
  pageAfter?: string
}

export interface ZendeskGetUsersResponse {
  success: boolean
  output: {
    users: any[]
    paging?: {
      after_cursor: string | null
      has_more: boolean
    }
    metadata: {
      total_returned: number
      has_more: boolean
    }
    success: boolean
  }
}

export const zendeskGetUsersTool: ToolConfig<ZendeskGetUsersParams, ZendeskGetUsersResponse> = {
  id: 'zendesk_get_users',
  name: 'Get Users from Zendesk',
  description: 'Retrieve a list of users from Zendesk with optional filtering',
  version: '1.0.0',

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk email address',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Zendesk API token',
    },
    subdomain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zendesk subdomain (e.g., "mycompany" for mycompany.zendesk.com)',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by role: "end-user", "agent", or "admin"',
    },
    permissionSet: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by permission set ID as a numeric string (e.g., "12345")',
    },
    perPage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page as a number string (default: "100", max: "100")',
    },
    pageAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous response to fetch the next page of results',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.role) queryParams.append('role', params.role)
      if (params.permissionSet) queryParams.append('permission_set', params.permissionSet)
      appendCursorPaginationParams(queryParams, params)

      const query = queryParams.toString()
      const url = buildZendeskUrl(params.subdomain, '/users')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => {
      const credentials = `${params.email}/token:${params.apiToken}`
      const base64Credentials = Buffer.from(credentials).toString('base64')
      return {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleZendeskError(data, response.status, 'get_users')
    }

    const data = await response.json()
    const users = data.users || []
    const paging = extractCursorPagingInfo(data)

    return {
      success: true,
      output: {
        users,
        paging,
        metadata: {
          total_returned: users.length,
          has_more: paging.has_more,
        },
        success: true,
      },
    }
  },

  outputs: {
    users: USERS_ARRAY_OUTPUT,
    paging: PAGING_OUTPUT,
    metadata: METADATA_OUTPUT,
  },
}
