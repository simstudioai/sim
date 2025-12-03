import type { ToolConfig } from '@/tools/types'
import type { WordPressListPagesParams, WordPressListPagesResponse } from './types'

export const listPagesTool: ToolConfig<WordPressListPagesParams, WordPressListPagesResponse> = {
  id: 'wordpress_list_pages',
  name: 'WordPress List Pages',
  description: 'List pages from WordPress with optional filters',
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
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of pages per request (default: 10, max: 100)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Page number for pagination',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Page status filter: publish, draft, pending, private',
    },
    parent: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Filter by parent page ID',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter pages',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order by field: date, id, title, slug, modified, menu_order',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order direction: asc or desc',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.siteUrl.replace(/\/$/, '')
      const queryParams = new URLSearchParams()

      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))
      if (params.status) queryParams.append('status', params.status)
      if (params.parent !== undefined) queryParams.append('parent', String(params.parent))
      if (params.search) queryParams.append('search', params.search)
      if (params.orderBy) queryParams.append('orderby', params.orderBy)
      if (params.order) queryParams.append('order', params.order)

      const queryString = queryParams.toString()
      return `${baseUrl}/wp-json/wp/v2/pages${queryString ? `?${queryString}` : ''}`
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
