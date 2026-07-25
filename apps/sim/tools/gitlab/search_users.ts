import type { GitLabSearchUsersParams, GitLabSearchUsersResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabSearchUsersTool: ToolConfig<GitLabSearchUsersParams, GitLabSearchUsersResponse> =
  {
    id: 'gitlab_search_users',
    name: 'GitLab Search Users',
    description:
      'Search for GitLab users by name, username, or email. Email matches must be exact; private emails match only with an admin token. Use this to resolve an email to a user ID before adding a member.',
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
      search: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Name, username, or email to search for',
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
        const queryParams = new URLSearchParams()
        queryParams.append('search', String(params.search).trim())
        if (params.perPage) queryParams.append('per_page', String(params.perPage))
        if (params.page) queryParams.append('page', String(params.page))

        return `${getGitLabApiBase(params.host)}/users?${queryParams.toString()}`
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

      const users = await response.json()
      const total = response.headers.get('x-total')

      return {
        success: true,
        output: {
          users,
          total: total ? Number.parseInt(total, 10) : users.length,
        },
      }
    },

    outputs: {
      users: {
        type: 'array',
        description: 'List of matching users',
      },
      total: {
        type: 'number',
        description: 'Total number of matching users',
      },
    },
  }
