import type {
  LinearListIssueRelationsParams,
  LinearListIssueRelationsResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListIssueRelationsTool: ToolConfig<
  LinearListIssueRelationsParams,
  LinearListIssueRelationsResponse
> = {
  id: 'linear_list_issue_relations',
  name: 'Linear List Issue Relations',
  description: 'List all relations (dependencies) for an issue in Linear',
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
      description: 'Number of relations to return (default: 50)',
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
        query ListIssueRelations($issueId: String!, $first: Int, $after: String) {
          issue(id: $issueId) {
            relations(first: $first, after: $after) {
              nodes {
                id
                type
                issue {
                  id
                  title
                }
                relatedIssue {
                  id
                  title
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
        error: data.errors[0]?.message || 'Failed to list issue relations',
        output: {},
      }
    }

    const result = data.data.issue.relations
    return {
      success: true,
      output: {
        relations: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    relations: {
      type: 'array',
      description: 'Array of issue relations',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Relation ID' },
          type: { type: 'string', description: 'Relation type' },
          issue: { type: 'object', description: 'Source issue' },
          relatedIssue: { type: 'object', description: 'Target issue' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
