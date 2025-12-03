import type { ToolConfig } from '@/tools/types'
import type { WordPressListPostsParams, WordPressListPostsResponse } from './types'

export const listPostsTool: ToolConfig<WordPressListPostsParams, WordPressListPostsResponse> = {
  id: 'wordpress_list_posts',
  name: 'WordPress List Posts',
  description: 'List blog posts from WordPress with optional filters',
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
      description: 'Number of posts per page (default: 10, max: 100)',
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
      description: 'Post status filter: publish, draft, pending, private',
    },
    author: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Filter by author ID',
    },
    categories: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated category IDs to filter by',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated tag IDs to filter by',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter posts',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order by field: date, id, title, slug, modified',
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
      return `${baseUrl}/wp-json/wp/v2/posts${queryString ? `?${queryString}` : ''}`
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
