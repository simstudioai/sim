import type { ToolConfig } from '@/tools/types'
import type { WordPressCreateCategoryParams, WordPressCreateCategoryResponse } from './types'

export const createCategoryTool: ToolConfig<
  WordPressCreateCategoryParams,
  WordPressCreateCategoryResponse
> = {
  id: 'wordpress_create_category',
  name: 'WordPress Create Category',
  description: 'Create a new category in WordPress',
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
    url: (params) => {
      const baseUrl = params.siteUrl.replace(/\/$/, '')
      return `${baseUrl}/wp-json/wp/v2/categories`
    },
    method: 'POST',
    headers: (params) => {
      const credentials = Buffer.from(`${params.username}:${params.applicationPassword}`).toString(
        'base64'
      )
      return {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      }
    },
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
