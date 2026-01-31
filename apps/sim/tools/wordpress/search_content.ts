import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressSearchContentParams,
  type WordPressSearchContentResponse,
} from '@/tools/wordpress/types'

export const searchContentTool: ToolConfig<
  WordPressSearchContentParams,
  WordPressSearchContentResponse
> = {
  id: 'wordpress_search_content',
  name: 'WordPress Search Content',
  description: 'Search across all content types in WordPress.com (posts, pages, media)',
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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results per request (default: 10, max: 100)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Page number for pagination',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by content type: post, page, attachment',
    },
    subtype: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by post type slug (e.g., post, page)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()

      queryParams.append('search', params.query)
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))
      if (params.type) queryParams.append('type', params.type)
      if (params.subtype) queryParams.append('subtype', params.subtype)

      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/search?${queryParams.toString()}`
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
        results: data.map((result: any) => ({
          id: result.id,
          title: result.title,
          url: result.url,
          type: result.type,
          subtype: result.subtype,
        })),
        total,
        totalPages,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Search results',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Content ID' },
          title: { type: 'string', description: 'Content title' },
          url: { type: 'string', description: 'Content URL' },
          type: { type: 'string', description: 'Content type (post, page, attachment)' },
          subtype: { type: 'string', description: 'Post type slug' },
        },
      },
    },
    total: {
      type: 'number',
      description: 'Total number of results',
    },
    totalPages: {
      type: 'number',
      description: 'Total number of result pages',
    },
  },
}
