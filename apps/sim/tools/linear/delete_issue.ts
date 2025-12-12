import type { LinearDeleteIssueParams, LinearDeleteIssueResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearDeleteIssueTool: ToolConfig<LinearDeleteIssueParams, LinearDeleteIssueResponse> =
  {
    id: 'linear_delete_issue',
    name: 'Linear Delete Issue',
    description: 'Delete (trash) an issue in Linear',
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
        description: 'Linear issue ID to delete',
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
        mutation DeleteIssue($id: String!) {
          issueDelete(id: $id) {
            success
          }
        }
      `,
        variables: {
          id: params.issueId,
        },
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()

      if (data.errors) {
        return {
          success: false,
          error: data.errors[0]?.message || 'Failed to delete issue',
          output: {},
        }
      }

      return {
        success: data.data.issueDelete.success,
        output: {
          success: data.data.issueDelete.success,
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
