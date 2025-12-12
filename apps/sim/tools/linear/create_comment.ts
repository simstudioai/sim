import type { LinearCreateCommentParams, LinearCreateCommentResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateCommentTool: ToolConfig<
  LinearCreateCommentParams,
  LinearCreateCommentResponse
> = {
  id: 'linear_create_comment',
  name: 'Linear Create Comment',
  description: 'Add a comment to an issue in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    issueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Linear issue ID to comment on',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment text (supports Markdown)',
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
        mutation CreateComment($input: CommentCreateInput!) {
          commentCreate(input: $input) {
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
              issue {
                id
                title
              }
            }
          }
        }
      `,
      variables: {
        input: {
          issueId: params.issueId,
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
        error: data.errors[0]?.message || 'Failed to create comment',
        output: {},
      }
    }

    const result = data.data.commentCreate
    if (!result.success) {
      return {
        success: false,
        error: 'Comment creation was not successful',
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
      description: 'The created comment',
      properties: {
        id: { type: 'string', description: 'Comment ID' },
        body: { type: 'string', description: 'Comment text' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        user: { type: 'object', description: 'User who created the comment' },
        issue: { type: 'object', description: 'Associated issue' },
      },
    },
  },
}
