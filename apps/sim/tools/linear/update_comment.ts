import type { LinearUpdateCommentParams, LinearUpdateCommentResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateCommentTool: ToolConfig<
  LinearUpdateCommentParams,
  LinearUpdateCommentResponse
> = {
  id: 'linear_update_comment',
  name: 'Linear Update Comment',
  description: 'Edit a comment in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment ID to update',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New comment text (supports Markdown)',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => ({
      query: `
        mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
          commentUpdate(id: $id, input: $input) {
            success
            comment {
              id
              body
              createdAt
              updatedAt
              user {
                id
                name
                email
              }
            }
          }
        }
      `,
      variables: {
        id: params.commentId,
        input: {
          body: params.body,
        },
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to update comment',
        output: {},
      }
    }

    const result = data.data.commentUpdate
    if (!result.success) {
      return {
        success: false,
        error: 'Comment update was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        comment: result.comment,
      },
    }
  },

  outputs: {
    comment: {
      type: 'object',
      description: 'The updated comment',
      properties: {
        id: { type: 'string', description: 'Comment ID' },
        body: { type: 'string', description: 'Comment text' },
        updatedAt: { type: 'string', description: 'Last update timestamp' },
        user: { type: 'object', description: 'User who created the comment' },
      },
    },
  },
}
