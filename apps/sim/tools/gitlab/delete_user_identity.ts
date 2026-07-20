import type {
  GitLabDeleteUserIdentityParams,
  GitLabDeleteUserIdentityResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabDeleteUserIdentityTool: ToolConfig<
  GitLabDeleteUserIdentityParams,
  GitLabDeleteUserIdentityResponse
> = {
  id: 'gitlab_delete_user_identity',
  name: 'GitLab Delete User Identity',
  description:
    "Delete a user's authentication identity (e.g. SAML or LDAP). Requires an administrator token with admin_mode on the instance.",
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitLab admin Personal Access Token (admin_mode)',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Self-managed GitLab host (e.g. gitlab.example.com). Defaults to gitlab.com.',
    },
    userId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the user',
    },
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The external identity provider name (e.g. saml, ldapmain)',
    },
  },

  request: {
    url: (params) => {
      const encodedProvider = encodeURIComponent(String(params.provider).trim())
      return `${getGitLabApiBase(params.host)}/users/${params.userId}/identities/${encodedProvider}`
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
      description: 'Whether the identity was deleted successfully',
    },
  },
}
