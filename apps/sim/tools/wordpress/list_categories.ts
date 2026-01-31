import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressListCategoriesParams,
  type WordPressListCategoriesResponse,
} from '@/tools/wordpress/types'

export const listCategoriesTool: ToolConfig<
  WordPressListCategoriesParams,
  WordPressListCategoriesResponse
> = {
  id: 'wordpress_list_categories',
  name: 'WordPress List Categories',
  description: 'List categories from WordPress.com',
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
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of categories per request (e.g., 10, 25, 50). Default: 10, max: 100',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (e.g., 1, 2, 3)',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter categories (e.g., "news", "technology")',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order direction: asc or desc',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()

      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))
      if (params.search) queryParams.append('search', params.search)
      if (params.order) queryParams.append('order', params.order)

      const queryString = queryParams.toString()
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/categories${queryString ? `?${queryString}` : ''}`
    },
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
    const total = Number.parseInt(response.headers.get('X-WP-Total') || '0', 10)
    const totalPages = Number.parseInt(response.headers.get('X-WP-TotalPages') || '0', 10)

    return {
      success: true,
      output: {
        categories: data.map((cat: any) => ({
          id: cat.id,
          count: cat.count,
          description: cat.description,
          link: cat.link,
          name: cat.name,
          slug: cat.slug,
          taxonomy: cat.taxonomy,
          parent: cat.parent,
        })),
        total,
        totalPages,
      },
    }
  },

  outputs: {
    categories: {
      type: 'array',
      description: 'List of categories',
      items: {
        type: 'object',
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
    total: {
      type: 'number',
      description: 'Total number of categories',
    },
    totalPages: {
      type: 'number',
      description: 'Total number of result pages',
    },
  },
}
