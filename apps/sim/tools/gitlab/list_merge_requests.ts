import type {
  GitLabListMergeRequestsParams,
  GitLabListMergeRequestsResponse,
} from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabListMergeRequestsTool: ToolConfig<
  GitLabListMergeRequestsParams,
  GitLabListMergeRequestsResponse
> = {
  id: 'gitlab_list_merge_requests',
  name: 'GitLab List Merge Requests',
  description: 'List merge requests in a GitLab project',
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
      description: 'Filter by state (opened, closed, merged, all)',
    },
    labels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of label names',
    },
    sourceBranch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by source branch',
    },
    targetBranch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by target branch',
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
      if (params.sourceBranch) queryParams.append('source_branch', params.sourceBranch)
      if (params.targetBranch) queryParams.append('target_branch', params.targetBranch)
      if (params.orderBy) queryParams.append('order_by', params.orderBy)
      if (params.sort) queryParams.append('sort', params.sort)
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `https://gitlab.com/api/v4/projects/${encodedId}/merge_requests${query ? `?${query}` : ''}`
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

    const mergeRequests = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        mergeRequests,
        total: total ? Number.parseInt(total, 10) : mergeRequests.length,
      },
    }
  },

  outputs: {
    mergeRequests: {
      type: 'array',
      description: 'List of GitLab merge requests',
    },
    total: {
      type: 'number',
      description: 'Total number of merge requests',
    },
  },
}
