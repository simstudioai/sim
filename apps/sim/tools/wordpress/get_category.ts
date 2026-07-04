import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressGetCategoryParams,
  type WordPressGetCategoryResponse,
} from '@/tools/wordpress/types'

export const getCategoryTool: ToolConfig<WordPressGetCategoryParams, WordPressGetCategoryResponse> =
  {
    id: 'wordpress_get_category',
    name: 'WordPress Get Category',
    description: 'Get a single category from WordPress.com by ID',
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
        description: 'The ID of the category to retrieve',
      },
    },

    request: {
      url: (params) => `${WORDPRESS_COM_API_BASE}/${params.siteId}/categories/${params.categoryId}`,
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
        description: 'The retrieved category',
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
