import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressCreatePostParams,
  type WordPressCreatePostResponse,
} from '@/tools/wordpress/types'

export const createPostTool: ToolConfig<WordPressCreatePostParams, WordPressCreatePostResponse> = {
  id: 'wordpress_create_post',
  name: 'WordPress Create Post',
  description: 'Create a new blog post in WordPress.com',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Post title',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Post content (HTML or plain text)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Post status: publish, draft, pending, private, or future',
    },
    excerpt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Post excerpt',
    },
    categories: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated category IDs',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag IDs',
    },
    featuredMedia: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Featured image media ID',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL slug for the post',
    },
  },

  request: {
    url: (params) => `${WORDPRESS_COM_API_BASE}/${params.siteId}/posts`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        title: params.title,
      }

      if (params.content) body.content = params.content
      if (params.status) body.status = params.status
      if (params.excerpt) body.excerpt = params.excerpt
      if (params.slug) body.slug = params.slug
      if (params.featuredMedia) body.featured_media = params.featuredMedia

      if (params.categories) {
        body.categories = params.categories
          .split(',')
          .map((id: string) => Number.parseInt(id.trim(), 10))
          .filter((id: number) => !Number.isNaN(id))
      }

      if (params.tags) {
        body.tags = params.tags
          .split(',')
          .map((id: string) => Number.parseInt(id.trim(), 10))
          .filter((id: number) => !Number.isNaN(id))
      }

      return body
    },
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
        post: {
          id: data.id,
          date: data.date,
          modified: data.modified,
          slug: data.slug,
          status: data.status,
          type: data.type,
          link: data.link,
          title: data.title,
          content: data.content,
          excerpt: data.excerpt,
          author: data.author,
          featured_media: data.featured_media,
          categories: data.categories || [],
          tags: data.tags || [],
        },
      },
    }
  },

  outputs: {
    post: {
      type: 'object',
      description: 'The created post',
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
}
