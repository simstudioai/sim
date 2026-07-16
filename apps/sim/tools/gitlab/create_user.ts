import type { GitLabCreateUserParams, GitLabUserResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabCreateUserTool: ToolConfig<GitLabCreateUserParams, GitLabUserResponse> = {
  id: 'gitlab_create_user',
  name: 'GitLab Create User',
  description:
    'Create a new GitLab user. Requires an administrator token with admin_mode on the instance.',
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
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The user's email address",
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The user's username",
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The user's display name",
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "The user's password. Omit and set resetPassword to email a reset link instead.",
    },
    resetPassword: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Send the user a password reset link instead of setting a password',
    },
    forceRandomPassword: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Set a random password without emailing a reset link (useful for SSO-only accounts). One of password, resetPassword, or forceRandomPassword is required.',
    },
    admin: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the new user is an administrator',
    },
    skipConfirmation: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip email confirmation for the new user',
    },
  },

  request: {
    url: (params) => `${getGitLabApiBase(params.host)}/users`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        email: params.email,
        username: params.username,
        name: params.name,
      }

      if (params.password) body.password = params.password
      if (params.resetPassword !== undefined) body.reset_password = params.resetPassword
      if (params.forceRandomPassword !== undefined)
        body.force_random_password = params.forceRandomPassword
      if (params.admin !== undefined) body.admin = params.admin
      if (params.skipConfirmation !== undefined) body.skip_confirmation = params.skipConfirmation

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
      description: 'The created user',
    },
  },
}
