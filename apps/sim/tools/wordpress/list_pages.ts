import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressListPagesParams,
  type WordPressListPagesResponse,
} from '@/tools/wordpress/types'

export const listPagesTool: ToolConfig<WordPressListPagesParams, WordPressListPagesResponse> = {
  id: 'wordpress_list_pages',
  name: 'WordPress List Pages',
  description: 'List pages from WordPress.com with optional filters',
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
      description: 'Number of pages per request (e.g., 10, 25, 50). Default: 10, max: 100',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (e.g., 1, 2, 3)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page status filter: publish, draft, pending, private',
    },
    parent: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by parent page ID (e.g., 123)',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter pages (e.g., "about", "contact")',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order by field: date, id, title, slug, modified, menu_order',
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
      if (params.status) queryParams.append('status', params.status)
      if (params.parent !== undefined) queryParams.append('parent', String(params.parent))
      if (params.search) queryParams.append('search', params.search)
      if (params.orderBy) queryParams.append('orderby', params.orderBy)
      if (params.order) queryParams.append('order', params.order)

      const queryString = queryParams.toString()
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/pages${queryString ? `?${queryString}` : ''}`
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
        pages: data.map((page: any) => ({
          id: page.id,
          date: page.date,
          modified: page.modified,
          slug: page.slug,
          status: page.status,
          type: page.type,
          link: page.link,
          title: page.title,
          content: page.content,
          excerpt: page.excerpt,
          author: page.author,
          featured_media: page.featured_media,
          parent: page.parent,
          menu_order: page.menu_order,
        })),
        total,
        totalPages,
      },
    }
  },

  outputs: {
    pages: {
      type: 'array',
      description: 'List of pages',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Page ID' },
          date: { type: 'string', description: 'Page creation date' },
          modified: { type: 'string', description: 'Page modification date' },
          slug: { type: 'string', description: 'Page slug' },
          status: { type: 'string', description: 'Page status' },
          type: { type: 'string', description: 'Content type' },
          link: { type: 'string', description: 'Page URL' },
          title: { type: 'object', description: 'Page title object' },
          content: { type: 'object', description: 'Page content object' },
          excerpt: { type: 'object', description: 'Page excerpt object' },
          author: { type: 'number', description: 'Author ID' },
          featured_media: { type: 'number', description: 'Featured media ID' },
          parent: { type: 'number', description: 'Parent page ID' },
          menu_order: { type: 'number', description: 'Menu order' },
        },
      },
    },
    total: {
      type: 'number',
      description: 'Total number of pages',
    },
    totalPages: {
      type: 'number',
      description: 'Total number of result pages',
    },
  },
}
