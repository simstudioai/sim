import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressCreateCategoryParams,
  type WordPressCreateCategoryResponse,
} from '@/tools/wordpress/types'

export const createCategoryTool: ToolConfig<
  WordPressCreateCategoryParams,
  WordPressCreateCategoryResponse
> = {
  id: 'wordpress_create_category',
  name: 'WordPress Create Category',
  description: 'Create a new category in WordPress.com',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Category name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Category description',
    },
    parent: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Parent category ID for hierarchical categories',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL slug for the category',
    },
  },

  request: {
    url: (params) => `${WORDPRESS_COM_API_BASE}/${params.siteId}/categories`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        name: params.name,
      }

      if (params.description) body.description = params.description
      if (params.parent) body.parent = params.parent
      if (params.slug) body.slug = params.slug

      return body
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
        category: {
          id: data.id,
          count: data.count,
          description: data.description,
          link: data.link,
          name: data.name,
          slug: data.slug,
          taxonomy: data.taxonomy,
          parent: data.parent,
        },
      },
    }
  },

  outputs: {
    category: {
      type: 'object',
      description: 'The created category',
      properties: {
        id: { type: 'number', description: 'Category ID' },
        count: { type: 'number', description: 'Number of posts in this category' },
        description: { type: 'string', description: 'Category description' },
        link: { type: 'string', description: 'Category archive URL' },
        name: { type: 'string', description: 'Category name' },
        slug: { type: 'string', description: 'Category slug' },
        taxonomy: { type: 'string', description: 'Taxonomy name' },
        parent: { type: 'number', description: 'Parent category ID' },
      },
    },
  },
}
