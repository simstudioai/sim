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
    'Add a SAML group link that maps an identity-provider group to a GitLab group at a given access level (GitLab Premium/Ultimate)',
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
      description: 'Group ID or path (e.g. my-org/my-group)',
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
        'Access level granted to members of the SAML group: 10 (Guest), 15 (Planner), 20 (Reporter), 25 (Security Manager), 30 (Developer), 40 (Maintainer), 50 (Owner)',
    },
    memberRoleId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom member role ID (GitLab Ultimate only)',
    },
    provider: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unique provider name that must match for this group link to be applied (GitLab 18.2+)',
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
      if (params.provider) body.provider = params.provider.trim()

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
