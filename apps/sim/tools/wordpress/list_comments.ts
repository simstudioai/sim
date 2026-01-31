import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressListCommentsParams,
  type WordPressListCommentsResponse,
} from '@/tools/wordpress/types'

export const listCommentsTool: ToolConfig<
  WordPressListCommentsParams,
  WordPressListCommentsResponse
> = {
  id: 'wordpress_list_comments',
  name: 'WordPress List Comments',
  description: 'List comments from WordPress.com with optional filters',
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
      description: 'Number of comments per request (e.g., 10, 25, 50). Default: 10, max: 100',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (e.g., 1, 2, 3)',
    },
    postId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by post ID (e.g., 123, 456)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by comment status: approved, hold, spam, trash',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter comments (e.g., "question", "feedback")',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order by field: date, id, parent',
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
      if (params.postId) queryParams.append('post', String(params.postId))
      if (params.status) queryParams.append('status', params.status)
      if (params.search) queryParams.append('search', params.search)
      if (params.orderBy) queryParams.append('orderby', params.orderBy)
      if (params.order) queryParams.append('order', params.order)

      const queryString = queryParams.toString()
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/comments${queryString ? `?${queryString}` : ''}`
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
        comments: data.map((comment: any) => ({
          id: comment.id,
          post: comment.post,
          parent: comment.parent,
          author: comment.author,
          author_name: comment.author_name,
          author_email: comment.author_email,
          author_url: comment.author_url,
          date: comment.date,
          content: comment.content,
          link: comment.link,
          status: comment.status,
        })),
        total,
        totalPages,
      },
    }
  },

  outputs: {
    comments: {
      type: 'array',
      description: 'List of comments',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Comment ID' },
          post: { type: 'number', description: 'Post ID' },
          parent: { type: 'number', description: 'Parent comment ID' },
          author: { type: 'number', description: 'Author user ID' },
          author_name: { type: 'string', description: 'Author display name' },
          author_email: { type: 'string', description: 'Author email' },
          author_url: { type: 'string', description: 'Author URL' },
          date: { type: 'string', description: 'Comment date' },
          content: { type: 'object', description: 'Comment content object' },
          link: { type: 'string', description: 'Comment permalink' },
          status: { type: 'string', description: 'Comment status' },
        },
      },
    },
    total: {
      type: 'number',
      description: 'Total number of comments',
    },
    totalPages: {
      type: 'number',
      description: 'Total number of result pages',
    },
  },
}
