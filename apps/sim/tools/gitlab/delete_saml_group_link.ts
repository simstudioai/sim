import type {
  GitLabDeleteSamlGroupLinkParams,
  GitLabDeleteSamlGroupLinkResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabDeleteSamlGroupLinkTool: ToolConfig<
  GitLabDeleteSamlGroupLinkParams,
  GitLabDeleteSamlGroupLinkResponse
> = {
  id: 'gitlab_delete_saml_group_link',
  name: 'GitLab Delete SAML Group Link',
  description: 'Delete a SAML group link from a GitLab group (GitLab Premium/Ultimate)',
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
      description: 'The name of the SAML group link to delete',
    },
    provider: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Provider name of the link to delete. Required when multiple links share the same SAML group name.',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.groupId).trim())
      const encodedName = encodeURIComponent(String(params.samlGroupName).trim())
      const queryParams = new URLSearchParams()
      if (params.provider) queryParams.append('provider', params.provider.trim())
      const query = queryParams.toString()
      return `${getGitLabApiBase(params.host)}/groups/${encodedId}/saml_group_links/${encodedName}${query ? `?${query}` : ''}`
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
      description: 'Whether the SAML group link was deleted successfully',
    },
  },
}
