import type { GitLabGetIssueParams, GitLabGetIssueResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabGetIssueTool: ToolConfig<GitLabGetIssueParams, GitLabGetIssueResponse> = {
  id: 'gitlab_get_issue',
  name: 'GitLab Get Issue',
  description: 'Get details of a specific GitLab issue',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'gitlab',
  },

  params: {
    projectId: {
      type: 'string',
      required: true,
      description: 'Project ID or URL-encoded path',
    },
    issueIid: {
      type: 'number',
      required: true,
      description: 'Issue internal ID (IID)',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId))
      return `https://gitlab.com/api/v4/projects/${encodedId}/issues/${params.issueIid}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for GitLab API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
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
