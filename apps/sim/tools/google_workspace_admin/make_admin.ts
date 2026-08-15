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

export const makeAdminTool: ToolConfig<
  GoogleWorkspaceAdminMakeAdminParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_make_admin',
  name: 'Google Workspace Admin Make Admin',
  description:
    'Grant super administrator privileges to a Google Workspace user, giving them full control of the account',
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
        'User to promote, given as their primary email address, alias email address, or unique user ID. This grants full administrative control',
    },
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}/makeAdmin`,
    method: 'POST',
    headers: adminHeaders,
    body: () => JSON.stringify({ status: true }),
  },

  transformResponse: async (response) => {
    await assertAdminSuccess(response, 'Failed to grant super administrator privileges')
    return {
      success: true,
      output: { message: 'User granted super administrator privileges' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation that the privilege was granted' },
  },
}
