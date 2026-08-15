import type {
  GoogleWorkspaceAdminRemoveUserAliasParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  assertAdminSuccess,
  DIRECTORY_API_BASE,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const removeUserAliasTool: ToolConfig<
  GoogleWorkspaceAdminRemoveUserAliasParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_remove_user_alias',
  name: 'Google Workspace Admin Remove User Alias',
  description:
    'Remove an alias email address from a Google Workspace user. Mail sent to the alias stops being delivered',
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
    alias: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alias email address to remove',
    },
  },

  request: {
    url: (params) =>
      `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}/aliases/${encodeURIComponent(params.alias)}`,
    method: 'DELETE',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    await assertAdminSuccess(response, 'Failed to remove user alias')
    return {
      success: true,
      output: { message: 'Alias removed successfully' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation that the alias was removed' },
  },
}
