import type { GitLabListReleasesParams, GitLabListReleasesResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabListReleasesTool: ToolConfig<
  GitLabListReleasesParams,
  GitLabListReleasesResponse
> = {
  id: 'gitlab_list_releases',
  name: 'GitLab List Releases',
  description: 'List releases in a GitLab project',
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
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order by field (released_at, created_at)',
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
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      const queryParams = new URLSearchParams()

      if (params.orderBy) queryParams.append('order_by', params.orderBy)
      if (params.sort) queryParams.append('sort', params.sort)
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/releases${query ? `?${query}` : ''}`
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

    const releases = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        releases: releases ?? [],
        total: total ? Number.parseInt(total, 10) : (releases?.length ?? 0),
      },
    }
  },

  outputs: {
    releases: {
      type: 'array',
      description: 'List of GitLab releases',
    },
    total: {
      type: 'number',
      description: 'Total number of releases',
    },
  },
}
