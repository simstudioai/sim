import type { ToolConfig } from '@/tools/types'
import type { WordPressCreateCommentParams, WordPressCreateCommentResponse } from './types'

export const createCommentTool: ToolConfig<
  WordPressCreateCommentParams,
  WordPressCreateCommentResponse
> = {
  id: 'wordpress_create_comment',
  name: 'WordPress Create Comment',
  description: 'Create a new comment on a WordPress post',
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
    postId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the post to comment on',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment content',
    },
    parent: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Parent comment ID for replies',
    },
    authorName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comment author display name',
    },
    authorEmail: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comment author email',
    },
    authorUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comment author URL',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.siteUrl.replace(/\/$/, '')
      return `${baseUrl}/wp-json/wp/v2/comments`
    },
    method: 'POST',
    headers: (params) => {
      const credentials = Buffer.from(`${params.username}:${params.applicationPassword}`).toString(
        'base64'
      )
      return {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      }
    },
    body: (params) => {
      const body: Record<string, any> = {
        post: params.postId,
        content: params.content,
      }

      if (params.parent) body.parent = params.parent
      if (params.authorName) body.author_name = params.authorName
      if (params.authorEmail) body.author_email = params.authorEmail
      if (params.authorUrl) body.author_url = params.authorUrl

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
      description: 'The created comment',
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
