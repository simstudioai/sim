import type { GitLabGetProjectParams, GitLabGetProjectResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabGetProjectTool: ToolConfig<GitLabGetProjectParams, GitLabGetProjectResponse> = {
  id: 'gitlab_get_project',
  name: 'GitLab Get Project',
  description: 'Get details of a specific GitLab project',
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
      description: 'Project ID or URL-encoded path (e.g., "namespace/project")',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId))
      return `https://gitlab.com/api/v4/projects/${encodedId}`
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

    const project = await response.json()

    return {
      success: true,
      output: {
        project,
      },
    }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'The GitLab project details',
    },
  },
}
