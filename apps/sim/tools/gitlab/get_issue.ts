import type { GitLabGetIssueParams, GitLabGetIssueResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabGetIssueTool: ToolConfig<GitLabGetIssueParams, GitLabGetIssueResponse> = {
  id: 'gitlab_get_issue',
  name: 'GitLab Get Issue',
  description: 'Get details of a specific GitLab issue',
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
      description: 'Issue number within the project (the # shown in GitLab UI)',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId))
      return `https://gitlab.com/api/v4/projects/${encodedId}/issues/${params.issueIid}`
    },
    method: 'GET',
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

    const issue = await response.json()

    return {
      success: true,
      output: {
        issue,
      },
    }
  },

  outputs: {
    issue: {
      type: 'object',
      description: 'The GitLab issue details',
    },
  },
}
