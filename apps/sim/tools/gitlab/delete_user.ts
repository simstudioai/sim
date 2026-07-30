import type { GitLabDeleteUserParams, GitLabDeleteUserResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabDeleteUserTool: ToolConfig<GitLabDeleteUserParams, GitLabDeleteUserResponse> = {
  id: 'gitlab_delete_user',
  name: 'GitLab Delete User',
  description:
    'Delete a GitLab user. Requires an administrator token with admin_mode on the instance.',
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
      description: 'The ID of the user to delete',
    },
    hardDelete: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When true, contributions, personal projects, AND groups owned solely by this user are deleted rather than moved to a Ghost User',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.hardDelete !== undefined) {
        queryParams.append('hard_delete', String(params.hardDelete))
      }
      const query = queryParams.toString()
      return `${getGitLabApiBase(params.host)}/users/${params.userId}${query ? `?${query}` : ''}`
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
      description: 'Whether the user was deleted successfully',
    },
  },
}
