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

export const suspendUserTool: ToolConfig<
  GoogleWorkspaceAdminSuspendUserParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_suspend_user',
  name: 'Google Workspace Admin Suspend User',
  description:
    'Suspend a Google Workspace user, immediately blocking sign-in and mail delivery while preserving the account',
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
        'User to suspend, given as their primary email address, alias email address, or unique user ID',
    },
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}`,
    method: 'PATCH',
    headers: adminHeaders,
    body: () => JSON.stringify({ suspended: true }),
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to suspend user')
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
