import type { ToolConfig } from '@/tools/types'
import {
  buildZendeskUrl,
  handleZendeskError,
  METADATA_OUTPUT,
  PAGING_OUTPUT,
  USERS_ARRAY_OUTPUT,
} from '@/tools/zendesk/types'

export interface ZendeskSearchUsersParams {
  email: string
  apiToken: string
  subdomain: string
  query?: string
  externalId?: string
  perPage?: string
  page?: string
}

export interface ZendeskSearchUsersResponse {
  success: boolean
  output: {
    users: any[]
    paging?: {
      next_page?: string | null
      previous_page?: string | null
      count: number
    }
    metadata: {
      total_returned: number
      has_more: boolean
    }
    success: boolean
  }
}

export const zendeskSearchUsersTool: ToolConfig<
  ZendeskSearchUsersParams,
  ZendeskSearchUsersResponse
> = {
  id: 'zendesk_search_users',
  name: 'Search Users in Zendesk',
  description: 'Search for users in Zendesk using a query string',
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
      description: 'Your Zendesk subdomain',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query string (e.g., user name or email)',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External ID to search by (your system identifier)',
    },
    perPage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page as a number string (default: "100", max: "100")',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number as a string (e.g., "1", "2")',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.query) queryParams.append('query', params.query)
      if (params.externalId) queryParams.append('external_id', params.externalId)
      if (params.page) queryParams.append('page', params.page)
      if (params.perPage) queryParams.append('per_page', params.perPage)

      const query = queryParams.toString()
      const url = buildZendeskUrl(params.subdomain, '/users/search')
      return `${url}?${query}`
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
      handleZendeskError(data, response.status, 'search_users')
    }

    const data = await response.json()
    const users = data.users || []

    return {
      success: true,
      output: {
        users,
        paging: {
          next_page: data.next_page ?? null,
          previous_page: data.previous_page ?? null,
          count: data.count || users.length,
        },
        metadata: {
          total_returned: users.length,
          has_more: !!data.next_page,
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
