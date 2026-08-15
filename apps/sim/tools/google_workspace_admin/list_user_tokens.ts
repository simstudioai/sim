import type {
  GoogleWorkspaceAdminListUserTokensParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

interface ListUserTokensApiResponse {
  items?: unknown[]
}

export const listUserTokensTool: ToolConfig<
  GoogleWorkspaceAdminListUserTokensParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_list_user_tokens',
  name: 'Google Workspace Admin List User Tokens',
  description:
    'List the third-party applications a Google Workspace user has issued OAuth access tokens to',
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
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}/tokens`,
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<ListUserTokensApiResponse>(
      response,
      'Failed to list user tokens'
    )
    return {
      success: true,
      output: { tokens: data.items ?? [] },
    }
  },

  outputs: {
    tokens: {
      type: 'json',
      description: 'Array of Token resources, one per application the user has authorized',
      items: {
        type: 'json',
        properties: {
          clientId: { type: 'string', description: 'OAuth client ID of the application' },
          displayText: { type: 'string', description: 'Display name of the application' },
          scopes: { type: 'json', description: 'Scopes the application was granted' },
          userKey: { type: 'string', description: 'Unique ID of the authorizing user' },
          anonymous: {
            type: 'boolean',
            description: 'Whether the application is registered with Google',
          },
          nativeApp: {
            type: 'boolean',
            description: 'Whether the token is issued to an installed application',
          },
        },
      },
    },
  },
}
