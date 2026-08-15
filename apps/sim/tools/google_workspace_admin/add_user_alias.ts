import type {
  GoogleWorkspaceAdminAddUserAliasParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const addUserAliasTool: ToolConfig<
  GoogleWorkspaceAdminAddUserAliasParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_add_user_alias',
  name: 'Google Workspace Admin Add User Alias',
  description: 'Add an alias email address to a Google Workspace user',
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
      description: 'Alias email address to add (e.g. jane@example.com)',
    },
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}/aliases`,
    method: 'POST',
    headers: adminHeaders,
    body: (params) => JSON.stringify({ alias: params.alias }),
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to add user alias')
    return {
      success: true,
      output: { alias: data },
    }
  },

  outputs: {
    alias: {
      type: 'json',
      description: 'The created UserAlias resource',
      properties: {
        id: { type: 'string', description: 'Unique ID of the user the alias belongs to' },
        primaryEmail: { type: 'string', description: "The user's primary email address" },
        alias: { type: 'string', description: 'The alias email address' },
      },
    },
  },
}
