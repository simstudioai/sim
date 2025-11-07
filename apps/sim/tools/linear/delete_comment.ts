import type { LinearDeleteCommentParams, LinearDeleteCommentResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearDeleteCommentTool: ToolConfig<
  LinearDeleteCommentParams,
  LinearDeleteCommentResponse
> = {
  id: 'linear_delete_comment',
  name: 'Linear Delete Comment',
  description: 'Delete a comment from Linear',
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
      description: 'Comment ID to delete',
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
        mutation DeleteComment($id: String!) {
          commentDelete(id: $id) {
            success
          }
        }
      `,
      variables: {
        id: params.commentId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to delete comment',
        output: {},
      }
    }

    return {
      success: data.data.commentDelete.success,
      output: {
        success: data.data.commentDelete.success,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the delete operation was successful',
    },
  },
}
