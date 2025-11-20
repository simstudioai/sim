import type { LinearArchiveIssueParams, LinearArchiveIssueResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearArchiveIssueTool: ToolConfig<
  LinearArchiveIssueParams,
  LinearArchiveIssueResponse
> = {
  id: 'linear_archive_issue',
  name: 'Linear Archive Issue',
  description: 'Archive an issue in Linear',
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
      description: 'Linear issue ID to archive',
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
        mutation ArchiveIssue($id: String!) {
          issueArchive(id: $id) {
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
        error: data.errors[0]?.message || 'Failed to archive issue',
        output: {},
      }
    }

    const result = data.data.issueArchive
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
      description: 'Whether the archive operation was successful',
    },
    issueId: {
      type: 'string',
      description: 'The ID of the archived issue',
    },
  },
}
