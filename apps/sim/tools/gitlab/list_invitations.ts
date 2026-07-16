import type {
  GitLabListInvitationsParams,
  GitLabListInvitationsResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase, getGitLabResourcePath } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabListInvitationsTool: ToolConfig<
  GitLabListInvitationsParams,
  GitLabListInvitationsResponse
> = {
  id: 'gitlab_list_invitations',
  name: 'GitLab List Invitations',
  description: 'List pending email invitations for a GitLab project or group',
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
      description: 'Project or group ID or URL-encoded path',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter invitations by invited email',
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

      if (params.query) queryParams.append('query', params.query)
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `${getGitLabApiBase(params.host)}/${resourcePath}/invitations${query ? `?${query}` : ''}`
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

    const invitations = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        invitations,
        total: total ? Number.parseInt(total, 10) : invitations.length,
      },
    }
  },

  outputs: {
    invitations: {
      type: 'array',
      description: 'List of pending invitations',
    },
    total: {
      type: 'number',
      description: 'Total number of invitations',
    },
  },
}
