import type { GitLabListProjectsParams, GitLabListProjectsResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabListProjectsTool: ToolConfig<
  GitLabListProjectsParams,
  GitLabListProjectsResponse
> = {
  id: 'gitlab_list_projects',
  name: 'GitLab List Projects',
  description: 'List GitLab projects accessible to the authenticated user',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitLab Personal Access Token',
    },
    owned: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Limit to projects owned by the current user',
    },
    membership: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Limit to projects the current user is a member of',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search projects by name',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by visibility (public, internal, private)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order by field (id, name, path, created_at, updated_at, last_activity_at)',
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
      if (params.membership) queryParams.append('membership', 'true')
      if (params.search) queryParams.append('search', params.search)
      if (params.visibility) queryParams.append('visibility', params.visibility)
      if (params.orderBy) queryParams.append('order_by', params.orderBy)
      if (params.sort) queryParams.append('sort', params.sort)
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `https://gitlab.com/api/v4/projects${query ? `?${query}` : ''}`
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

    const projects = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        projects,
        total: total ? Number.parseInt(total, 10) : projects.length,
      },
    }
  },

  outputs: {
    projects: {
      type: 'array',
      description: 'List of GitLab projects',
    },
    total: {
      type: 'number',
      description: 'Total number of projects',
    },
  },
}
