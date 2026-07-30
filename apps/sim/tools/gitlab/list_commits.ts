import type { GitLabListCommitsParams, GitLabListCommitsResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabListCommitsTool: ToolConfig<GitLabListCommitsParams, GitLabListCommitsResponse> =
  {
    id: 'gitlab_list_commits',
    name: 'GitLab List Commits',
    description: 'List commits in a GitLab project repository',
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
        description: 'Project ID or path (e.g. mygroup/myproject)',
      },
      refName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Branch, tag, or revision range to list commits from',
      },
      since: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only commits after this ISO 8601 date',
      },
      until: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only commits before this ISO 8601 date',
      },
      path: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only commits affecting this file path',
      },
      author: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter commits by author',
      },
      perPage: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of results per page (default 20, max 100)',
      },
      page: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Page number for pagination',
      },
    },

    request: {
      url: (params) => {
        const encodedId = encodeURIComponent(String(params.projectId).trim())
        const queryParams = new URLSearchParams()

        if (params.refName) queryParams.append('ref_name', params.refName)
        if (params.since) queryParams.append('since', params.since)
        if (params.until) queryParams.append('until', params.until)
        if (params.path) queryParams.append('path', params.path)
        if (params.author) queryParams.append('author', params.author)
        if (params.perPage) queryParams.append('per_page', String(params.perPage))
        if (params.page) queryParams.append('page', String(params.page))

        const query = queryParams.toString()
        return `${getGitLabApiBase(params.host)}/projects/${encodedId}/repository/commits${query ? `?${query}` : ''}`
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

      const commits = await response.json()
      const total = response.headers.get('x-total')

      return {
        success: true,
        output: {
          commits: commits ?? [],
          total: total ? Number.parseInt(total, 10) : (commits?.length ?? 0),
        },
      }
    },

    outputs: {
      commits: {
        type: 'array',
        description: 'List of commits',
      },
      total: {
        type: 'number',
        description:
          'Number of commits returned on this page (GitLab does not report a grand total for commits)',
      },
    },
  }
