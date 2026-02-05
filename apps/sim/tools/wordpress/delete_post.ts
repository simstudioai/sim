import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressDeletePostParams,
  type WordPressDeletePostResponse,
} from '@/tools/wordpress/types'

export const deletePostTool: ToolConfig<WordPressDeletePostParams, WordPressDeletePostResponse> = {
  id: 'wordpress_delete_post',
  name: 'WordPress Delete Post',
  description: 'Delete a blog post from WordPress.com',
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
    postId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the post to delete',
    },
    force: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Bypass trash and force delete permanently',
    },
  },

  request: {
    url: (params) => {
      const forceParam = params.force ? '?force=true' : ''
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/posts/${params.postId}${forceParam}`
    },
    method: 'DELETE',
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
        deleted: data.deleted || true,
        post: {
          id: data.id || data.previous?.id,
          date: data.date || data.previous?.date,
          modified: data.modified || data.previous?.modified,
          slug: data.slug || data.previous?.slug,
          status: data.status || data.previous?.status || 'trash',
          type: data.type || data.previous?.type,
          link: data.link || data.previous?.link,
          title: data.title || data.previous?.title,
          content: data.content || data.previous?.content,
          excerpt: data.excerpt || data.previous?.excerpt,
          author: data.author || data.previous?.author,
          featured_media: data.featured_media || data.previous?.featured_media,
          categories: data.categories || data.previous?.categories || [],
          tags: data.tags || data.previous?.tags || [],
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the post was deleted',
    },
    post: {
      type: 'object',
      description: 'The deleted post',
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
