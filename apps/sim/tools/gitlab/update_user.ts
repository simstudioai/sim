import type { GitLabUpdateUserParams, GitLabUserResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabUpdateUserTool: ToolConfig<GitLabUpdateUserParams, GitLabUserResponse> = {
  id: 'gitlab_update_user',
  name: 'GitLab Update User',
  description:
    'Modify an existing GitLab user. Requires an administrator token with admin_mode on the instance.',
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
      description: 'The ID of the user to modify',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "The user's new email address (GitLab only allows changing to one of the user's existing verified secondary emails)",
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The user's new username",
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The user's new display name",
    },
    admin: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the user is an administrator',
    },
  },

  request: {
    url: (params) => `${getGitLabApiBase(params.host)}/users/${params.userId}`,
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.email) body.email = params.email
      if (params.username) body.username = params.username
      if (params.name) body.name = params.name
      // Strict boolean check: an untouched block switch serializes as `null`,
      // which must not be sent (GitLab would treat it as a demotion).
      if (typeof params.admin === 'boolean') body.admin = params.admin

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

    const user = await response.json()

    return {
      success: true,
      output: {
        user,
      },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The updated user',
    },
  },
}
