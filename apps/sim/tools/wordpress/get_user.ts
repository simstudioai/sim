import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressGetUserParams,
  type WordPressGetUserResponse,
} from '@/tools/wordpress/types'

export const getUserTool: ToolConfig<WordPressGetUserParams, WordPressGetUserResponse> = {
  id: 'wordpress_get_user',
  name: 'WordPress Get User',
  description: 'Get a specific user from WordPress.com by ID',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'wordpress',
    requiredScopes: ['global'],
  },

  params: {
    siteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'WordPress.com site ID or domain (e.g., 12345678 or mysite.wordpress.com)',
    },
    userId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the user to retrieve',
    },
  },

  request: {
    url: (params) => `${WORDPRESS_COM_API_BASE}/${params.siteId}/users/${params.userId}`,
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || `WordPress API error: ${response.status}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        user: {
          id: data.id,
          username: data.username,
          name: data.name,
          first_name: data.first_name,
          last_name: data.last_name,
          email: data.email,
          url: data.url,
          description: data.description,
          link: data.link,
          slug: data.slug,
          roles: data.roles || [],
          avatar_urls: data.avatar_urls,
        },
      },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The retrieved user',
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
}
