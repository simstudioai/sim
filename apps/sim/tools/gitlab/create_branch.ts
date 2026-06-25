import type { GitLabCreateBranchParams, GitLabCreateBranchResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabCreateBranchTool: ToolConfig<
  GitLabCreateBranchParams,
  GitLabCreateBranchResponse
> = {
  id: 'gitlab_create_branch',
  name: 'GitLab Create Branch',
  description: 'Create a new branch in a GitLab project repository',
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
      description: 'Name of the new branch',
    },
    ref: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source branch/tag/SHA',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      const queryParams = new URLSearchParams()
      queryParams.append('branch', String(params.branch))
      queryParams.append('ref', String(params.ref))
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/repository/branches?${queryParams.toString()}`
    },
    method: 'POST',
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

    const data = await response.json()

    return {
      success: true,
      output: {
        name: data.name ?? null,
        webUrl: data.web_url ?? null,
        protected: data.protected ?? null,
        commit: data.commit ?? null,
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'The created branch name',
    },
    webUrl: {
      type: 'string',
      description: 'The web URL of the branch',
    },
    protected: {
      type: 'boolean',
      description: 'Whether the branch is protected',
    },
    commit: {
      type: 'object',
      description: 'The commit the branch points to',
    },
  },
}
