import type {
  GoogleWorkspaceAdminDeleteUserParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  assertAdminSuccess,
  DIRECTORY_API_BASE,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteUserTool: ToolConfig<
  GoogleWorkspaceAdminDeleteUserParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_delete_user',
  name: 'Google Workspace Admin Delete User',
  description:
    'Permanently delete a Google Workspace user account. This removes the account and its data, and cannot be undone after the Workspace recovery window',
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
        'User to delete, given as their primary email address, alias email address, or unique user ID. This is destructive and irreversible',
    },
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}`,
    method: 'DELETE',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    await assertAdminSuccess(response, 'Failed to delete user')
    return {
      success: true,
      output: { message: 'User deleted successfully' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation that the user was deleted' },
  },
}
