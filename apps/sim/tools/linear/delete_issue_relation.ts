import type {
  LinearDeleteIssueRelationParams,
  LinearDeleteIssueRelationResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearDeleteIssueRelationTool: ToolConfig<
  LinearDeleteIssueRelationParams,
  LinearDeleteIssueRelationResponse
> = {
  id: 'linear_delete_issue_relation',
  name: 'Linear Delete Issue Relation',
  description: 'Remove a relation between two issues in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    relationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Relation ID to delete',
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
        mutation DeleteIssueRelation($id: String!) {
          issueRelationDelete(id: $id) {
            success
          }
        }
      `,
      variables: {
        id: params.relationId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to delete issue relation',
        output: {},
      }
    }

    return {
      success: data.data.issueRelationDelete.success,
      output: {
        success: data.data.issueRelationDelete.success,
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
