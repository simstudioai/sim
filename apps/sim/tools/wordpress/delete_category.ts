import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressDeleteCategoryParams,
  type WordPressDeleteCategoryResponse,
} from '@/tools/wordpress/types'

export const deleteCategoryTool: ToolConfig<
  WordPressDeleteCategoryParams,
  WordPressDeleteCategoryResponse
> = {
  id: 'wordpress_delete_category',
  name: 'WordPress Delete Category',
  description: 'Delete a category from WordPress.com',
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
    categoryId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the category to delete',
    },
  },

  request: {
    url: (params) => {
      // Terms do not support trashing, so force=true is required to delete.
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/categories/${params.categoryId}?force=true`
    },
    method: 'DELETE',
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
        deleted: data.deleted ?? true,
        category: {
          id: data.id || data.previous?.id,
          count: data.count || data.previous?.count,
          description: data.description || data.previous?.description,
          link: data.link || data.previous?.link,
          name: data.name || data.previous?.name,
          slug: data.slug || data.previous?.slug,
          taxonomy: data.taxonomy || data.previous?.taxonomy,
          parent: data.parent || data.previous?.parent,
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the category was deleted',
    },
    category: {
      type: 'object',
      description: 'The deleted category',
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
