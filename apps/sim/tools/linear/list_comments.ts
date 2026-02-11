import type { LinearListCommentsParams, LinearListCommentsResponse } from '@/tools/linear/types'
import { COMMENT_OUTPUT_PROPERTIES, PAGE_INFO_OUTPUT } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListCommentsTool: ToolConfig<
  LinearListCommentsParams,
  LinearListCommentsResponse
> = {
  id: 'linear_list_comments',
  name: 'Linear List Comments',
  description: 'List all comments on an issue in Linear',
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
      description: 'Linear issue ID',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of comments to return (default: 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
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
        query ListComments($issueId: String!, $first: Int, $after: String) {
          issue(id: $issueId) {
            comments(first: $first, after: $after) {
              nodes {
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
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      variables: {
        issueId: params.issueId,
        first: params.first ? Number(params.first) : 50,
        after: params.after,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list comments',
        output: {},
      }
    }

    if (!data.data?.issue) {
      return {
        success: false,
        error: 'Issue not found',
        output: {},
      }
    }

    const result = data.data.issue.comments
    return {
      success: true,
      output: {
        comments: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    comments: {
      type: 'array',
      description: 'Array of comments on the issue',
      items: {
        type: 'object',
        properties: COMMENT_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: PAGE_INFO_OUTPUT,
  },
}
