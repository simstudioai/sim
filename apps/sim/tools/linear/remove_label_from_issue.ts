import type {
  LinearRemoveLabelFromIssueParams,
  LinearRemoveLabelResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearRemoveLabelFromIssueTool: ToolConfig<
  LinearRemoveLabelFromIssueParams,
  LinearRemoveLabelResponse
> = {
  id: 'linear_remove_label_from_issue',
  name: 'Linear Remove Label from Issue',
  description: 'Remove a label from an issue in Linear',
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
    labelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Label ID to remove from the issue',
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
        mutation RemoveLabelFromIssue($issueId: String!, $labelId: String!) {
          issueRemoveLabel(id: $issueId, labelId: $labelId) {
            success
          }
        }
      `,
      variables: {
        issueId: params.issueId,
        labelId: params.labelId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to remove label from issue',
        output: {},
      }
    }

    return {
      success: data.data.issueRemoveLabel.success,
      output: {
        success: data.data.issueRemoveLabel.success,
        issueId: response.ok ? data.data.issueRemoveLabel.success : '',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the label was successfully removed',
    },
    issueId: {
      type: 'string',
      description: 'The ID of the issue',
    },
  },
}
