import type {
  GitLabListSamlGroupLinksParams,
  GitLabListSamlGroupLinksResponse,
} from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabListSamlGroupLinksTool: ToolConfig<
  GitLabListSamlGroupLinksParams,
  GitLabListSamlGroupLinksResponse
> = {
  id: 'gitlab_list_saml_group_links',
  name: 'GitLab List SAML Group Links',
  description:
    'List SAML group links for a GitLab group. Use this to detect whether a group is governed by SAML group sync before provisioning members.',
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
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group ID or path (e.g. my-org/my-group)',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.groupId).trim())
      return `${getGitLabApiBase(params.host)}/groups/${encodedId}/saml_group_links`
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

    const samlGroupLinks = await response.json()

    return {
      success: true,
      output: {
        samlGroupLinks,
        total: Array.isArray(samlGroupLinks) ? samlGroupLinks.length : 0,
      },
    }
  },

  outputs: {
    samlGroupLinks: {
      type: 'array',
      description: 'List of SAML group links',
    },
    total: {
      type: 'number',
      description: 'Number of SAML group links',
    },
  },
}
