import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressDeleteCommentParams,
  type WordPressDeleteCommentResponse,
} from '@/tools/wordpress/types'

export const deleteCommentTool: ToolConfig<
  WordPressDeleteCommentParams,
  WordPressDeleteCommentResponse
> = {
  id: 'wordpress_delete_comment',
  name: 'WordPress Delete Comment',
  description: 'Delete a comment from WordPress.com',
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
    commentId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the comment to delete',
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
      return `${WORDPRESS_COM_API_BASE}/${params.siteId}/comments/${params.commentId}${forceParam}`
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
        comment: {
          id: data.id || data.previous?.id,
          post: data.post || data.previous?.post,
          parent: data.parent || data.previous?.parent,
          author: data.author || data.previous?.author,
          author_name: data.author_name || data.previous?.author_name,
          author_email: data.author_email || data.previous?.author_email,
          author_url: data.author_url || data.previous?.author_url,
          date: data.date || data.previous?.date,
          content: data.content || data.previous?.content,
          link: data.link || data.previous?.link,
          status: data.status || data.previous?.status || 'trash',
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the comment was deleted',
    },
    comment: {
      type: 'object',
      description: 'The deleted comment',
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
}
