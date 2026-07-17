import type {
  GitLabListUserMembershipsParams,
  GitLabListUserMembershipsResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabListUserMembershipsTool: ToolConfig<
  GitLabListUserMembershipsParams,
  GitLabListUserMembershipsResponse
> = {
  id: 'gitlab_list_user_memberships',
  name: 'GitLab List User Memberships',
  description:
    "List a user's project and group memberships. Requires an administrator access token (GET /users/:id/memberships is admin-only). For a non-admin path, iterate List Members on each project or group instead.",
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitLab Personal Access Token (must belong to an administrator)',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Self-managed GitLab host (e.g. gitlab.example.com). Defaults to gitlab.com.',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the user whose memberships to list',
    },
    membershipType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Filter by source: 'Project' or 'Namespace' (group). Omit for all memberships.",
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
      const encodedId = encodeURIComponent(String(params.userId).trim())
      const queryParams = new URLSearchParams()
      if (params.membershipType) queryParams.append('type', params.membershipType)
      if (params.perPage) queryParams.append('per_page', String(params.perPage))
      if (params.page) queryParams.append('page', String(params.page))

      const query = queryParams.toString()
      return `${getGitLabApiBase(params.host)}/users/${encodedId}/memberships${
        query ? `?${query}` : ''
      }`
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

    const memberships = await response.json()
    const total = response.headers.get('x-total')

    return {
      success: true,
      output: {
        memberships,
        total: total ? Number.parseInt(total, 10) : memberships.length,
      },
    }
  },

  outputs: {
    memberships: {
      type: 'array',
      description: "The user's project and group memberships",
    },
    total: {
      type: 'number',
      description: 'Total number of memberships',
    },
  },
}
