import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressListPostsParams,
  type WordPressListPostsResponse,
} from '@/tools/wordpress/types'

export const listPostsTool: ToolConfig<WordPressListPostsParams, WordPressListPostsResponse> = {
  id: 'wordpress_list_posts',
  name: 'WordPress List Posts',
  description: 'List blog posts from WordPress.com with optional filters',
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
      description: 'Number of posts per page (e.g., 10, 25, 50). Default: 10, max: 100',
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
      description: 'Post status filter: publish, draft, pending, private',
    },
    author: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by author ID (e.g., 1, 42)',
    },
    categories: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated category IDs to filter by (e.g., "1,2,3")',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag IDs to filter by (e.g., "5,10,15")',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter posts (e.g., "tutorial", "announcement")',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order by field: date, id, title, slug, modified',
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
      if (params.author) queryParams.append('author', String(params.author))
      if (params.search) queryParams.append('search', params.search)
      if (params.orderBy) queryParams.append('orderby', params.orderBy)
      if (params.order) queryParams.append('order', params.order)

      if (params.categories) {
        const catIds = params.categories
          .split(',')
          .map((id: string) => id.trim())
          .filter((id: string) => id.length > 0)
        queryParams.append('categories', catIds.join(','))
      }

      if (params.tags) {
        const tagIds = params.tags
          .split(',')
          .map((id: string) => id.trim())
          .filter((id: string) => id.length > 0)
        queryParams.append('tags', tagIds.join(','))
      }

      const queryString = queryParams.toString()
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/posts${queryString ? `?${queryString}` : ''}`
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
        posts: data.map((post: any) => ({
          id: post.id,
          date: post.date,
          modified: post.modified,
          slug: post.slug,
          status: post.status,
          type: post.type,
          link: post.link,
          title: post.title,
          content: post.content,
          excerpt: post.excerpt,
          author: post.author,
          featured_media: post.featured_media,
          categories: post.categories || [],
          tags: post.tags || [],
        })),
        total,
        totalPages,
      },
    }
  },

  outputs: {
    posts: {
      type: 'array',
      description: 'List of posts',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Post ID' },
          date: { type: 'string', description: 'Post creation date' },
          modified: { type: 'string', description: 'Post modification date' },
          slug: { type: 'string', description: 'Post slug' },
          status: { type: 'string', description: 'Post status' },
          type: { type: 'string', description: 'Post type' },
          link: { type: 'string', description: 'Post URL' },
          title: { type: 'object', description: 'Post title object' },
          content: { type: 'object', description: 'Post content object' },
          excerpt: { type: 'object', description: 'Post excerpt object' },
          author: { type: 'number', description: 'Author ID' },
          featured_media: { type: 'number', description: 'Featured media ID' },
          categories: { type: 'array', description: 'Category IDs' },
          tags: { type: 'array', description: 'Tag IDs' },
        },
      },
    },
    total: {
      type: 'number',
      description: 'Total number of posts',
    },
    totalPages: {
      type: 'number',
      description: 'Total number of pages',
    },
  },
}
