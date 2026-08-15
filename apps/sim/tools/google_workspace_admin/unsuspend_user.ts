import type {
  GoogleWorkspaceAdminResponse,
  GoogleWorkspaceAdminSuspendUserParams,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const unsuspendUserTool: ToolConfig<
  GoogleWorkspaceAdminSuspendUserParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_unsuspend_user',
  name: 'Google Workspace Admin Unsuspend User',
  description: 'Restore a suspended Google Workspace user account so the user can sign in again',
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
        'User to restore, given as their primary email address, alias email address, or unique user ID',
    },
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}`,
    method: 'PATCH',
    headers: adminHeaders,
    body: () => JSON.stringify({ suspended: false }),
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to unsuspend user')
    return {
      success: true,
      output: { user: data },
    }
  },

  outputs: {
    user: {
      type: 'json',
      description: 'The updated Directory API User resource',
      properties: {
        id: { type: 'string', description: 'Unique user ID' },
        primaryEmail: { type: 'string', description: 'Primary email address' },
        suspended: { type: 'boolean', description: 'Whether the account is suspended' },
      },
    },
  },
}
