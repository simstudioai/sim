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
  description: 'Delete a SAML group link from a GitLab group',
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
      description: 'The name of the SAML group link to delete',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.groupId).trim())
      const encodedName = encodeURIComponent(String(params.samlGroupName).trim())
      return `${getGitLabApiBase(params.host)}/groups/${encodedId}/saml_group_links/${encodedName}`
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
