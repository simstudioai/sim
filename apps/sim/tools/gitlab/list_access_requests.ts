import type {
  GitLabListAccessRequestsParams,
  GitLabListAccessRequestsResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase, getGitLabResourcePath } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabListAccessRequestsTool: ToolConfig<
  GitLabListAccessRequestsParams,
  GitLabListAccessRequestsResponse
> = {
  id: 'gitlab_list_access_requests',
  name: 'GitLab List Access Requests',
  description: 'List pending access requests for a GitLab project or group',
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
    resourceType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Whether the resource is a 'project' or a 'group'",
    },
    resourceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project or group ID or path (e.g. mygroup/myproject)',
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
      const resourcePath = getGitLabResourcePath(params.resourceType, params.resourceId)
      const queryParams = new URLSearchParams()

      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `${getGitLabApiBase(params.host)}/${resourcePath}/access_requests${query ? `?${query}` : ''}`
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

    const accessRequests = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        accessRequests,
        total: total ? Number.parseInt(total, 10) : accessRequests.length,
      },
    }
  },

  outputs: {
    accessRequests: {
      type: 'array',
      description: 'List of pending access requests',
    },
    total: {
      type: 'number',
      description: 'Total number of access requests',
    },
  },
}
