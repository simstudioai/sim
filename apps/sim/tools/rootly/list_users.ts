import type { RootlyListUsersParams, RootlyListUsersResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyListUsersTool: ToolConfig<RootlyListUsersParams, RootlyListUsersResponse> = {
  id: 'rootly_list_users',
  name: 'Rootly List Users',
  description: 'List users from Rootly with optional search and email filtering.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter users',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter users by email address',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items per page (default: 20)',
    },
    pageNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.search) queryParams.set('filter[search]', params.search)
      if (params.email) queryParams.set('filter[email]', params.email)
      if (params.pageSize) queryParams.set('page[size]', String(params.pageSize))
      if (params.pageNumber) queryParams.set('page[number]', String(params.pageNumber))
      const qs = queryParams.toString()
      return `https://api.rootly.com/v1/users${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { users: [], totalCount: 0 },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const users = (data.data || []).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes || {}) as Record<string, unknown>
      return {
        id: item.id ?? null,
        email: (attrs.email as string) ?? '',
        firstName: (attrs.first_name as string) ?? null,
        lastName: (attrs.last_name as string) ?? null,
        fullName: (attrs.full_name as string) ?? null,
        timeZone: (attrs.time_zone as string) ?? null,
        createdAt: (attrs.created_at as string) ?? '',
        updatedAt: (attrs.updated_at as string) ?? '',
      }
    })

    return {
      success: true,
      output: {
        users,
        totalCount: data.meta?.total_count ?? users.length,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'List of users',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique user ID' },
          email: { type: 'string', description: 'User email address' },
          firstName: { type: 'string', description: 'User first name' },
          lastName: { type: 'string', description: 'User last name' },
          fullName: { type: 'string', description: 'User full name' },
          timeZone: { type: 'string', description: 'User time zone' },
          createdAt: { type: 'string', description: 'Creation date' },
          updatedAt: { type: 'string', description: 'Last update date' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of users returned',
    },
  },
}
