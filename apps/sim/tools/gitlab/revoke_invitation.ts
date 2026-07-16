import type {
  GitLabRevokeInvitationParams,
  GitLabRevokeInvitationResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase, getGitLabResourcePath } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabRevokeInvitationTool: ToolConfig<
  GitLabRevokeInvitationParams,
  GitLabRevokeInvitationResponse
> = {
  id: 'gitlab_revoke_invitation',
  name: 'GitLab Revoke Invitation',
  description: 'Revoke a pending email invitation to a GitLab project or group',
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
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the invitation to revoke',
    },
  },

  request: {
    url: (params) => {
      const resourcePath = getGitLabResourcePath(params.resourceType, params.resourceId)
      const encodedEmail = encodeURIComponent(String(params.email).trim())
      return `${getGitLabApiBase(params.host)}/${resourcePath}/invitations/${encodedEmail}`
    },
    method: 'DELETE',
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

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the invitation was revoked successfully',
    },
  },
}
