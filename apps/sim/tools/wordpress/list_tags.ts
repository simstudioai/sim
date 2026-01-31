import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressListTagsParams,
  type WordPressListTagsResponse,
} from '@/tools/wordpress/types'

export const listTagsTool: ToolConfig<WordPressListTagsParams, WordPressListTagsResponse> = {
  id: 'wordpress_list_tags',
  name: 'WordPress List Tags',
  description: 'List tags from WordPress.com',
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
      description: 'Number of tags per request (e.g., 10, 25, 50). Default: 10, max: 100',
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
      description: 'Search term to filter tags (e.g., "javascript", "tutorial")',
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
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/tags${queryString ? `?${queryString}` : ''}`
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
        tags: data.map((tag: any) => ({
          id: tag.id,
          count: tag.count,
          description: tag.description,
          link: tag.link,
          name: tag.name,
          slug: tag.slug,
          taxonomy: tag.taxonomy,
        })),
        total,
        totalPages,
      },
    }
  },

  outputs: {
    tags: {
      type: 'array',
      description: 'List of tags',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Tag ID' },
          count: { type: 'number', description: 'Number of posts with this tag' },
          description: { type: 'string', description: 'Tag description' },
          link: { type: 'string', description: 'Tag archive URL' },
          name: { type: 'string', description: 'Tag name' },
          slug: { type: 'string', description: 'Tag slug' },
          taxonomy: { type: 'string', description: 'Taxonomy name' },
        },
      },
    },
    total: {
      type: 'number',
      description: 'Total number of tags',
    },
    totalPages: {
      type: 'number',
      description: 'Total number of result pages',
    },
  },
}
