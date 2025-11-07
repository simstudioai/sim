import type {
  LinearListAttachmentsParams,
  LinearListAttachmentsResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListAttachmentsTool: ToolConfig<
  LinearListAttachmentsParams,
  LinearListAttachmentsResponse
> = {
  id: 'linear_list_attachments',
  name: 'Linear List Attachments',
  description: 'List all attachments on an issue in Linear',
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
      description: 'Issue ID',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of attachments to return (default: 50)',
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
        query ListAttachments($issueId: String!, $first: Int, $after: String) {
          issue(id: $issueId) {
            attachments(first: $first, after: $after) {
              nodes {
                id
                title
                subtitle
                url
                createdAt
                updatedAt
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
        error: data.errors[0]?.message || 'Failed to list attachments',
        output: {},
      }
    }

    const result = data.data.issue.attachments
    return {
      success: true,
      output: {
        attachments: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    attachments: {
      type: 'array',
      description: 'Array of attachments',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Attachment ID' },
          title: { type: 'string', description: 'Attachment title' },
          subtitle: { type: 'string', description: 'Attachment subtitle' },
          url: { type: 'string', description: 'Attachment URL' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
