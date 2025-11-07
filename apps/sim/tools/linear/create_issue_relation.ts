import type {
  LinearCreateIssueRelationParams,
  LinearCreateIssueRelationResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateIssueRelationTool: ToolConfig<
  LinearCreateIssueRelationParams,
  LinearCreateIssueRelationResponse
> = {
  id: 'linear_create_issue_relation',
  name: 'Linear Create Issue Relation',
  description: 'Link two issues together in Linear (blocks, relates to, duplicates)',
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
      description: 'Source issue ID',
    },
    relatedIssueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target issue ID to link to',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Relation type: "blocks", "blocked", "duplicate", "related"',
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
        mutation CreateIssueRelation($input: IssueRelationCreateInput!) {
          issueRelationCreate(input: $input) {
            success
            issueRelation {
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
          }
        }
      `,
      variables: {
        input: {
          issueId: params.issueId,
          relatedIssueId: params.relatedIssueId,
          type: params.type,
        },
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to create issue relation',
        output: {},
      }
    }

    const result = data.data.issueRelationCreate
    if (!result.success) {
      return {
        success: false,
        error: 'Issue relation creation was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        relation: result.issueRelation,
      },
    }
  },

  outputs: {
    relation: {
      type: 'object',
      description: 'The created issue relation',
      properties: {
        id: { type: 'string', description: 'Relation ID' },
        type: { type: 'string', description: 'Relation type' },
        issue: { type: 'object', description: 'Source issue' },
        relatedIssue: { type: 'object', description: 'Target issue' },
      },
    },
  },
}
