import type { GitLabDeleteIssueParams, GitLabDeleteIssueResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabDeleteIssueTool: ToolConfig<GitLabDeleteIssueParams, GitLabDeleteIssueResponse> =
  {
    id: 'gitlab_delete_issue',
    name: 'GitLab Delete Issue',
    description: 'Delete an issue from a GitLab project',
    version: '1.0.0',

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'GitLab Personal Access Token',
      },
      projectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Project ID or URL-encoded path',
      },
      issueIid: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Issue internal ID (IID)',
      },
    },

    request: {
      url: (params) => {
        const encodedId = encodeURIComponent(String(params.projectId))
        return `https://gitlab.com/api/v4/projects/${encodedId}/issues/${params.issueIid}`
      },
      method: 'DELETE',
      headers: (params) => ({
        'PRIVATE-TOKEN': params.accessToken,
      }),
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          error: `GitLab API error: ${response.status} ${errorText}`,
          output: {},
        }
      }

      return {
        success: true,
        output: {
          success: true,
        },
      }
    },

    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the issue was deleted successfully',
      },
    },
  }
