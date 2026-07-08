import type {
  GitLabCompareBranchesParams,
  GitLabCompareBranchesResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabCompareBranchesTool: ToolConfig<
  GitLabCompareBranchesParams,
  GitLabCompareBranchesResponse
> = {
  id: 'gitlab_compare_branches',
  name: 'GitLab Compare Branches',
  description: 'Compare two branches, tags, or commits in a GitLab project repository',
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
    from: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Commit SHA or branch/tag name to compare from',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Commit SHA or branch/tag name to compare to',
    },
    straight: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Compare directly from..to instead of using the merge base (defaults to false)',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      const queryParams = new URLSearchParams()
      queryParams.append('from', params.from)
      queryParams.append('to', params.to)
      if (params.straight) queryParams.append('straight', 'true')

      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/repository/compare?${queryParams.toString()}`
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

    const data = await response.json()

    return {
      success: true,
      output: {
        commit: data.commit ?? null,
        commits: data.commits ?? [],
        diffs: data.diffs ?? [],
        compareTimeout: data.compare_timeout ?? null,
        compareSameRef: data.compare_same_ref ?? null,
        webUrl: data.web_url ?? null,
      },
    }
  },

  outputs: {
    commit: {
      type: 'object',
      description: 'The latest commit in the comparison',
    },
    commits: {
      type: 'array',
      description: 'Commits between the two references',
    },
    diffs: {
      type: 'array',
      description: 'File diffs between the two references',
    },
    compareTimeout: {
      type: 'boolean',
      description: 'Whether the comparison exceeded size limits or timed out',
    },
    compareSameRef: {
      type: 'boolean',
      description: 'Whether both references point to the same commit',
    },
    webUrl: {
      type: 'string',
      description: 'The web URL for viewing the comparison',
    },
  },
}
