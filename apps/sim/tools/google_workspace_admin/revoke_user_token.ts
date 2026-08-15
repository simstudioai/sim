import type {
  GoogleWorkspaceAdminResponse,
  GoogleWorkspaceAdminRevokeUserTokenParams,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  assertAdminSuccess,
  DIRECTORY_API_BASE,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const revokeUserTokenTool: ToolConfig<
  GoogleWorkspaceAdminRevokeUserTokenParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_revoke_user_token',
  name: 'Google Workspace Admin Revoke User Token',
  description:
    'Revoke every OAuth access token a Google Workspace user has issued to one application, cutting off that application immediately',
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
      description: 'User identifier: primary email address, alias email address, or unique user ID',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'OAuth client ID of the application to revoke, as returned by List User Tokens. Every token that application holds for this user is deleted',
    },
  },

  request: {
    url: (params) =>
      `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}/tokens/${encodeURIComponent(params.clientId)}`,
    method: 'DELETE',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    await assertAdminSuccess(response, 'Failed to revoke user token')
    return {
      success: true,
      output: { message: 'Application tokens revoked successfully' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation that the tokens were revoked' },
  },
}
