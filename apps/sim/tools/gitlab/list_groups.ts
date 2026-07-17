import type { GitLabListGroupsParams, GitLabListGroupsResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabListGroupsTool: ToolConfig<GitLabListGroupsParams, GitLabListGroupsResponse> = {
  id: 'gitlab_list_groups',
  name: 'GitLab List Groups',
  description: 'List GitLab groups accessible to the authenticated user',
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
    owned: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Limit to groups owned by the current user',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search groups by name or path',
    },
    topLevelOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Limit to top-level groups, excluding subgroups',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by visibility: public, internal, or private',
    },
    minAccessLevel: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only groups where the current user has at least this access level, as an integer (e.g. 30 for Developer). Valid values: 5, 10, 15, 20, 25, 30, 40, 50.',
    },
    allAvailable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include all groups the user can access, not only groups they are a member of (ignored when owned or a minimum access level is set)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Order by field (name, path, id, similarity). similarity requires a search term.',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction (asc, desc)',
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
      if (params.owned) queryParams.append('owned', 'true')
      if (params.search) queryParams.append('search', params.search)
      if (params.topLevelOnly) queryParams.append('top_level_only', 'true')
      if (params.visibility) queryParams.append('visibility', params.visibility)
      if (params.minAccessLevel && params.minAccessLevel > 0) {
        queryParams.append('min_access_level', String(params.minAccessLevel))
      }
      if (params.allAvailable) queryParams.append('all_available', 'true')
      if (params.orderBy) queryParams.append('order_by', params.orderBy)
      if (params.sort) queryParams.append('sort', params.sort)
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `${getGitLabApiBase(params.host)}/groups${query ? `?${query}` : ''}`
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

    const groups = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        groups,
        total: total ? Number.parseInt(total, 10) : groups.length,
      },
    }
  },

  outputs: {
    groups: {
      type: 'array',
      description: 'List of GitLab groups',
    },
    total: {
      type: 'number',
      description: 'Total number of groups',
    },
  },
}
