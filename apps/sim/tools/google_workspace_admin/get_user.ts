import type {
  GoogleWorkspaceAdminGetUserParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  appendQueryParams,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const getUserTool: ToolConfig<
  GoogleWorkspaceAdminGetUserParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_get_user',
  name: 'Google Workspace Admin Get User',
  description: 'Read a single Google Workspace directory user',
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
    projection: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Fields to include: BASIC, CUSTOM, or FULL',
    },
    viewType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Whether to read the admin_view or the domain_public view of the user',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}`)
      appendQueryParams(url, {
        projection: params.projection,
        viewType: params.viewType,
      })
      return url.toString()
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to get user')
    return {
      success: true,
      output: { user: data },
    }
  },

  outputs: {
    user: {
      type: 'json',
      description: 'Directory API User resource',
      properties: {
        id: { type: 'string', description: 'Unique user ID' },
        primaryEmail: { type: 'string', description: 'Primary email address' },
        name: { type: 'json', description: 'Name object with givenName, familyName, fullName' },
        isAdmin: { type: 'boolean', description: 'Whether the user is a super administrator' },
        suspended: { type: 'boolean', description: 'Whether the account is suspended' },
        orgUnitPath: { type: 'string', description: 'Org unit the user belongs to' },
        aliases: { type: 'json', description: 'Alias email addresses', optional: true },
        lastLoginTime: { type: 'string', description: 'Last login timestamp', optional: true },
      },
    },
  },
}
