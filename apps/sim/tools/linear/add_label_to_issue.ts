import type { LinearAddLabelResponse, LinearAddLabelToIssueParams } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearAddLabelToIssueTool: ToolConfig<
  LinearAddLabelToIssueParams,
  LinearAddLabelResponse
> = {
  id: 'linear_add_label_to_issue',
  name: 'Linear Add Label to Issue',
  description: 'Add a label to an issue in Linear',
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
      description: 'Label ID to add to the issue',
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
        mutation AddLabelToIssue($issueId: String!, $labelId: String!) {
          issueAddLabel(id: $issueId, labelId: $labelId) {
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
        error: data.errors[0]?.message || 'Failed to add label to issue',
        output: {},
      }
    }

    return {
      success: data.data.issueAddLabel.success,
      output: {
        success: data.data.issueAddLabel.success,
        issueId: response.ok ? data.data.issueAddLabel.success : '',
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the label was successfully added',
    },
    issueId: {
      type: 'string',
      description: 'The ID of the issue',
    },
  },
}
