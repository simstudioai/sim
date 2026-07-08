import type { GitLabDeleteBranchParams, GitLabDeleteBranchResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabDeleteBranchTool: ToolConfig<
  GitLabDeleteBranchParams,
  GitLabDeleteBranchResponse
> = {
  id: 'gitlab_delete_branch',
  name: 'GitLab Delete Branch',
  description: 'Delete a branch from a GitLab project repository',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitLab Personal Access Token',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Self-managed GitLab host (e.g. gitlab.example.com). Defaults to gitlab.com.',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID or URL-encoded path',
    },
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the branch to delete',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      const encodedBranch = encodeURIComponent(String(params.branch).trim())
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/repository/branches/${encodedBranch}`
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
      description: 'Whether the branch was deleted successfully',
    },
  },
}
