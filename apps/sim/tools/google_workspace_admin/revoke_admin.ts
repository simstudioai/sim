import type {
  GoogleWorkspaceAdminMakeAdminParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  assertAdminSuccess,
  DIRECTORY_API_BASE,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const revokeAdminTool: ToolConfig<
  GoogleWorkspaceAdminMakeAdminParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_revoke_admin',
  name: 'Google Workspace Admin Revoke Admin',
  description: 'Revoke super administrator privileges from a Google Workspace user',
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
        'User to demote, given as their primary email address, alias email address, or unique user ID',
    },
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}/makeAdmin`,
    method: 'POST',
    headers: adminHeaders,
    body: () => JSON.stringify({ status: false }),
  },

  transformResponse: async (response) => {
    await assertAdminSuccess(response, 'Failed to revoke super administrator privileges')
    return {
      success: true,
      output: { message: 'User super administrator privileges revoked' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation that the privilege was revoked' },
  },
}
