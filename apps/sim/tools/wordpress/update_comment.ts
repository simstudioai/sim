import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressUpdateCommentParams,
  type WordPressUpdateCommentResponse,
} from '@/tools/wordpress/types'

export const updateCommentTool: ToolConfig<
  WordPressUpdateCommentParams,
  WordPressUpdateCommentResponse
> = {
  id: 'wordpress_update_comment',
  name: 'WordPress Update Comment',
  description: 'Update a comment in WordPress.com (content or status)',
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
      description: 'The ID of the comment to update',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated comment content',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment status: approved, hold, spam, trash',
    },
  },

  request: {
    url: (params) => `${WORDPRESS_COM_API_BASE}/${params.siteId}/comments/${params.commentId}`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.content) body.content = params.content
      if (params.status) body.status = params.status

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
        comment: {
          id: data.id,
          post: data.post,
          parent: data.parent,
          author: data.author,
          author_name: data.author_name,
          author_email: data.author_email,
          author_url: data.author_url,
          date: data.date,
          content: data.content,
          link: data.link,
          status: data.status,
        },
      },
    }
  },

  outputs: {
    comment: {
      type: 'object',
      description: 'The updated comment',
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
