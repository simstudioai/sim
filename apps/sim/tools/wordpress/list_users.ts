import type { ToolConfig } from '@/tools/types'
import type { WordPressListUsersParams, WordPressListUsersResponse } from './types'

export const listUsersTool: ToolConfig<WordPressListUsersParams, WordPressListUsersResponse> = {
  id: 'wordpress_list_users',
  name: 'WordPress List Users',
  description: 'List users from WordPress (requires admin privileges)',
  version: '1.0.0',

  params: {
    siteUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'WordPress site URL (e.g., https://example.com)',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'WordPress username',
    },
    applicationPassword: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'WordPress Application Password',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of users per request (default: 10, max: 100)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Page number for pagination',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter users',
    },
    roles: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated role names to filter by',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order by field: id, name, slug, email, registered_date',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order direction: asc or desc',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.siteUrl.replace(/\/$/, '')
      const queryParams = new URLSearchParams()

      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))
      if (params.search) queryParams.append('search', params.search)
      if (params.roles) queryParams.append('roles', params.roles)
      if (params.orderBy) queryParams.append('orderby', params.orderBy)
      if (params.order) queryParams.append('order', params.order)

      const queryString = queryParams.toString()
      return `${baseUrl}/wp-json/wp/v2/users${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params) => {
      const credentials = Buffer.from(`${params.username}:${params.applicationPassword}`).toString(
        'base64'
      )
      return {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || `WordPress API error: ${response.status}`)
    }

    const data = await response.json()
    const total = Number.parseInt(response.headers.get('X-WP-Total') || '0', 10)
    const totalPages = Number.parseInt(response.headers.get('X-WP-TotalPages') || '0', 10)

    return {
      success: true,
      output: {
        users: data.map((user: any) => ({
          id: user.id,
          username: user.username,
          name: user.name,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          url: user.url,
          description: user.description,
          link: user.link,
          slug: user.slug,
          roles: user.roles || [],
          avatar_urls: user.avatar_urls,
        })),
        total,
        totalPages,
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
          id: { type: 'number', description: 'User ID' },
          username: { type: 'string', description: 'Username' },
          name: { type: 'string', description: 'Display name' },
          first_name: { type: 'string', description: 'First name' },
          last_name: { type: 'string', description: 'Last name' },
          email: { type: 'string', description: 'Email address' },
          url: { type: 'string', description: 'User website URL' },
          description: { type: 'string', description: 'User bio' },
          link: { type: 'string', description: 'Author archive URL' },
          slug: { type: 'string', description: 'User slug' },
          roles: { type: 'array', description: 'User roles' },
          avatar_urls: { type: 'object', description: 'Avatar URLs at different sizes' },
        },
      },
    },
    total: {
      type: 'number',
      description: 'Total number of users',
    },
    totalPages: {
      type: 'number',
      description: 'Total number of result pages',
    },
  },
}
