import type {
  GitLabApproveAccessRequestParams,
  GitLabApproveAccessRequestResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase, getGitLabResourcePath } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabApproveAccessRequestTool: ToolConfig<
  GitLabApproveAccessRequestParams,
  GitLabApproveAccessRequestResponse
> = {
  id: 'gitlab_approve_access_request',
  name: 'GitLab Approve Access Request',
  description: 'Approve a pending access request for a GitLab project or group',
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
    userId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ID of the access requester',
    },
    accessLevel: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Access level to grant: 10 (Guest), 15 (Planner), 20 (Reporter), 25 (Security Manager), 30 (Developer), 40 (Maintainer), 50 (Owner). Defaults to 30 (Developer).',
    },
  },

  request: {
    url: (params) => {
      const resourcePath = getGitLabResourcePath(params.resourceType, params.resourceId)
      const queryParams = new URLSearchParams()

      if (params.accessLevel !== undefined) {
        queryParams.append('access_level', String(params.accessLevel))
      }

      const query = queryParams.toString()
      return `${getGitLabApiBase(params.host)}/${resourcePath}/access_requests/${params.userId}/approve${query ? `?${query}` : ''}`
    },
    method: 'PUT',
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

    const accessRequest = await response.json()

    return {
      success: true,
      output: {
        accessRequest,
      },
    }
  },

  outputs: {
    accessRequest: {
      type: 'object',
      description: 'The approved access request',
    },
  },
}
