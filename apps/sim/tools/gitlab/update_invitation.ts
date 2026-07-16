import type {
  GitLabUpdateInvitationParams,
  GitLabUpdateInvitationResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase, getGitLabResourcePath } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabUpdateInvitationTool: ToolConfig<
  GitLabUpdateInvitationParams,
  GitLabUpdateInvitationResponse
> = {
  id: 'gitlab_update_invitation',
  name: 'GitLab Update Invitation',
  description: 'Update a pending invitation to a GitLab project or group',
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
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the invitation to update',
    },
    accessLevel: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New access level: 10 (Guest), 20 (Reporter), 30 (Developer), 40 (Maintainer), 50 (Owner)',
    },
    expiresAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Access expiration date in YYYY-MM-DD format',
    },
  },

  request: {
    url: (params) => {
      const resourcePath = getGitLabResourcePath(params.resourceType, params.resourceId)
      const encodedEmail = encodeURIComponent(String(params.email).trim())
      return `${getGitLabApiBase(params.host)}/${resourcePath}/invitations/${encodedEmail}`
    },
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.accessLevel !== undefined) body.access_level = params.accessLevel
      if (params.expiresAt) body.expires_at = params.expiresAt

      return body
    },
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

    const invitation = await response.json()

    return {
      success: true,
      output: {
        invitation,
      },
    }
  },

  outputs: {
    invitation: {
      type: 'object',
      description: 'The updated invitation',
    },
  },
}
