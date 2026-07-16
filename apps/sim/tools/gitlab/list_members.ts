import type { GitLabListMembersParams, GitLabListMembersResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase, getGitLabResourcePath } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabListMembersTool: ToolConfig<GitLabListMembersParams, GitLabListMembersResponse> =
  {
    id: 'gitlab_list_members',
    name: 'GitLab List Members',
    description:
      'List members of a GitLab project or group. Includes members inherited from ancestor groups by default.',
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
      directOnly: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'When true, returns only direct members. Defaults to false, which also returns members inherited from ancestor groups.',
      },
      query: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter members by name, email, or username',
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
        const membersPath = params.directOnly ? 'members' : 'members/all'
        const queryParams = new URLSearchParams()

        if (params.query) queryParams.append('query', params.query)
        if (params.perPage) queryParams.append('per_page', String(params.perPage))
        if (params.page) queryParams.append('page', String(params.page))

        const query = queryParams.toString()
        return `${getGitLabApiBase(params.host)}/${resourcePath}/${membersPath}${query ? `?${query}` : ''}`
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

      const members = await response.json()
      const total = response.headers.get('x-total')

      return {
        success: true,
        output: {
          members,
          total: total ? Number.parseInt(total, 10) : members.length,
        },
      }
    },

    outputs: {
      members: {
        type: 'array',
        description: 'List of project or group members',
      },
      total: {
        type: 'number',
        description: 'Total number of members',
      },
    },
  }
