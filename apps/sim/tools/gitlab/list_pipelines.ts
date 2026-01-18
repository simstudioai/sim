import type { GitLabListPipelinesParams, GitLabListPipelinesResponse } from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabListPipelinesTool: ToolConfig<
  GitLabListPipelinesParams,
  GitLabListPipelinesResponse
> = {
  id: 'gitlab_list_pipelines',
  name: 'GitLab List Pipelines',
  description: 'List pipelines in a GitLab project',
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
    ref: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by ref (branch or tag)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by status (created, waiting_for_resource, preparing, pending, running, success, failed, canceled, skipped, manual, scheduled)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order by field (id, status, ref, updated_at, user_id)',
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

      if (params.ref) queryParams.append('ref', params.ref)
      if (params.status) queryParams.append('status', params.status)
      if (params.orderBy) queryParams.append('order_by', params.orderBy)
      if (params.sort) queryParams.append('sort', params.sort)
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `https://gitlab.com/api/v4/projects/${encodedId}/pipelines${query ? `?${query}` : ''}`
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

    const pipelines = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        pipelines,
        total: total ? Number.parseInt(total, 10) : pipelines.length,
      },
    }
  },

  outputs: {
    pipelines: {
      type: 'array',
      description: 'List of GitLab pipelines',
    },
    total: {
      type: 'number',
      description: 'Total number of pipelines',
    },
  },
}
