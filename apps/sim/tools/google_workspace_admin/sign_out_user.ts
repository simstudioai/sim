import type {
  GoogleWorkspaceAdminResponse,
  GoogleWorkspaceAdminSignOutUserParams,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  assertAdminSuccess,
  DIRECTORY_API_BASE,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const signOutUserTool: ToolConfig<
  GoogleWorkspaceAdminSignOutUserParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_sign_out_user',
  name: 'Google Workspace Admin Sign Out User',
  description:
    'Sign a Google Workspace user out of all web and device sessions, invalidating their sign-in cookies',
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
        'User to sign out, given as their primary email address, alias email address, or unique user ID. All of their active sessions are terminated',
    },
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}/signOut`,
    method: 'POST',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    await assertAdminSuccess(response, 'Failed to sign out user')
    return {
      success: true,
      output: { message: 'User signed out of all sessions' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation that the sessions were terminated' },
  },
}
