import type {
  GitLabAddSamlGroupLinkParams,
  GitLabSamlGroupLinkResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabAddSamlGroupLinkTool: ToolConfig<
  GitLabAddSamlGroupLinkParams,
  GitLabSamlGroupLinkResponse
> = {
  id: 'gitlab_add_saml_group_link',
  name: 'GitLab Add SAML Group Link',
  description:
    'Add a SAML group link that maps an identity-provider group to a GitLab group at a given access level',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitLab Personal Access Token with group Owner rights',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Self-managed GitLab host (e.g. gitlab.example.com). Defaults to gitlab.com.',
    },
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group ID or URL-encoded path',
    },
    samlGroupName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the SAML group as sent by the identity provider',
    },
    accessLevel: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Access level granted to members of the SAML group: 10 (Guest), 20 (Reporter), 30 (Developer), 40 (Maintainer), 50 (Owner)',
    },
    memberRoleId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom member role ID (GitLab Ultimate only)',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.groupId).trim())
      return `${getGitLabApiBase(params.host)}/groups/${encodedId}/saml_group_links`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        saml_group_name: params.samlGroupName,
        access_level: params.accessLevel,
      }

      if (params.memberRoleId !== undefined) body.member_role_id = params.memberRoleId

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

    const samlGroupLink = await response.json()

    return {
      success: true,
      output: {
        samlGroupLink,
      },
    }
  },

  outputs: {
    samlGroupLink: {
      type: 'object',
      description: 'The created SAML group link',
    },
  },
}
