import type {
  GoogleWorkspaceAdminListUserAliasesParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

interface ListUserAliasesApiResponse {
  aliases?: unknown[]
}

export const listUserAliasesTool: ToolConfig<
  GoogleWorkspaceAdminListUserAliasesParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_list_user_aliases',
  name: 'Google Workspace Admin List User Aliases',
  description: 'List the alias email addresses assigned to a Google Workspace user',
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
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}/aliases`,
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<ListUserAliasesApiResponse>(
      response,
      'Failed to list user aliases'
    )
    return {
      success: true,
      output: { aliases: data.aliases ?? [] },
    }
  },

  outputs: {
    aliases: {
      type: 'json',
      description: 'Array of UserAlias resources',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Unique ID of the user the alias belongs to' },
          primaryEmail: { type: 'string', description: "The user's primary email address" },
          alias: { type: 'string', description: 'The alias email address' },
        },
      },
    },
  },
}
