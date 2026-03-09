import type { GitLabListIssuesParams, GitLabListIssuesResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabListIssuesTool: ToolConfig<GitLabListIssuesParams, GitLabListIssuesResponse> = {
  id: 'gitlab_list_issues',
  name: 'GitLab List Issues',
  description: 'List issues in a GitLab project',
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
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by state (opened, closed, all)',
    },
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of label names',
    },
    assigneeId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by assignee user ID',
    },
    milestoneTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by milestone title',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search issues by title and description',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order by field (created_at, updated_at)',
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
      const encodedId = encodeURIComponent(String(params.projectId))
      const queryParams = new URLSearchParams()

      if (params.state) queryParams.append('state', params.state)
      if (params.labels) queryParams.append('labels', params.labels)
      if (params.assigneeId) queryParams.append('assignee_id', String(params.assigneeId))
      if (params.milestoneTitle) queryParams.append('milestone', params.milestoneTitle)
      if (params.search) queryParams.append('search', params.search)
      if (params.orderBy) queryParams.append('order_by', params.orderBy)
      if (params.sort) queryParams.append('sort', params.sort)
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `https://gitlab.com/api/v4/projects/${encodedId}/issues${query ? `?${query}` : ''}`
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

    const issues = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        issues,
        total: total ? Number.parseInt(total, 10) : issues.length,
      },
    }
  },

  outputs: {
    issues: {
      type: 'array',
      description: 'List of GitLab issues',
    },
    total: {
      type: 'number',
      description: 'Total number of issues',
    },
  },
}
