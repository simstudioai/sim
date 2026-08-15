import type {
  GoogleWorkspaceAdminResetPasswordParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const resetPasswordTool: ToolConfig<
  GoogleWorkspaceAdminResetPasswordParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_reset_password',
  name: 'Google Workspace Admin Reset Password',
  description:
    'Set a new password on a Google Workspace user account, optionally forcing a password change at next sign-in',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-workspace-admin',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    userKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'User whose password is being reset, given as their primary email address, alias email address, or unique user ID',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'New password. 8-100 ASCII characters in clear text, or a valid hash when hashFunction is set. Never returned by the API',
    },
    changePasswordAtNextLogin: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Force the user to choose a new password at next sign-in. Has no effect for users signing in through a third-party identity provider',
    },
    hashFunction: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Hash format of the supplied password: MD5, SHA-1, or crypt. Omit when sending a clear-text password',
    },
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}`,
    method: 'PATCH',
    headers: adminHeaders,
    body: (params) => {
      const body: Record<string, unknown> = { password: params.password }

      if (params.changePasswordAtNextLogin !== undefined) {
        body.changePasswordAtNextLogin = params.changePasswordAtNextLogin
      }
      if (params.hashFunction) body.hashFunction = params.hashFunction

      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to reset password')
    return {
      success: true,
      output: { user: data },
    }
  },

  outputs: {
    user: {
      type: 'json',
      description: 'The updated Directory API User resource. The password is never returned',
      properties: {
        id: { type: 'string', description: 'Unique user ID' },
        primaryEmail: { type: 'string', description: 'Primary email address' },
        changePasswordAtNextLogin: {
          type: 'boolean',
          description: 'Whether the user must change their password at next sign-in',
          optional: true,
        },
      },
    },
  },
}
