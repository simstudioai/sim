import type { LinearUnarchiveIssueParams, LinearUnarchiveIssueResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUnarchiveIssueTool: ToolConfig<
  LinearUnarchiveIssueParams,
  LinearUnarchiveIssueResponse
> = {
  id: 'linear_unarchive_issue',
  name: 'Linear Unarchive Issue',
  description: 'Unarchive (restore) an archived issue in Linear',
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
      description: 'Linear issue ID to unarchive',
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
        mutation UnarchiveIssue($id: String!) {
          issueUnarchive(id: $id) {
            success
            entity {
              id
            }
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
        error: data.errors[0]?.message || 'Failed to unarchive issue',
        output: {},
      }
    }

    const result = data.data.issueUnarchive
    return {
      success: result.success,
      output: {
        success: result.success,
        issueId: result.entity?.id,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the unarchive operation was successful',
    },
    issueId: {
      type: 'string',
      description: 'The ID of the unarchived issue',
    },
  },
}
