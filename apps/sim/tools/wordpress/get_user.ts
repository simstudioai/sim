import type { ToolConfig } from '@/tools/types'
import type { WordPressGetUserParams, WordPressGetUserResponse } from './types'

export const getUserTool: ToolConfig<WordPressGetUserParams, WordPressGetUserResponse> = {
  id: 'wordpress_get_user',
  name: 'WordPress Get User',
  description: 'Get a specific user from WordPress by ID',
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
    userId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the user to retrieve',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.siteUrl.replace(/\/$/, '')
      return `${baseUrl}/wp-json/wp/v2/users/${params.userId}`
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
