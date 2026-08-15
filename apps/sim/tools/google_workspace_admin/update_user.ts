import type {
  GoogleWorkspaceAdminResponse,
  GoogleWorkspaceAdminUpdateUserParams,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const updateUserTool: ToolConfig<
  GoogleWorkspaceAdminUpdateUserParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_update_user',
  name: 'Google Workspace Admin Update User',
  description: 'Update profile fields on an existing Google Workspace directory user',
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
    primaryEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New primary email address. Renaming a user also renames their mailbox',
    },
    givenName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New first name for the user',
    },
    familyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New last name for the user',
    },
    orgUnitPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full path of the org unit to move the user into (e.g. /Sales/West)',
    },
    suspended: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Set the suspended state of the account',
    },
    recoveryEmail: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Recovery email address for the account',
    },
    recoveryPhone: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Recovery phone number in E.164 format (e.g. +16505551212)',
    },
  },

  request: {
    url: (params) => `${DIRECTORY_API_BASE}/users/${encodeURIComponent(params.userKey)}`,
    method: 'PUT',
    headers: adminHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.primaryEmail) body.primaryEmail = params.primaryEmail
      if (params.givenName || params.familyName) {
        const name: Record<string, string> = {}
        if (params.givenName) name.givenName = params.givenName
        if (params.familyName) name.familyName = params.familyName
        body.name = name
      }
      if (params.orgUnitPath) body.orgUnitPath = params.orgUnitPath
      if (params.suspended !== undefined) body.suspended = params.suspended
      if (params.recoveryEmail) body.recoveryEmail = params.recoveryEmail
      if (params.recoveryPhone) body.recoveryPhone = params.recoveryPhone

      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to update user')
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
        name: { type: 'json', description: 'Name object with givenName, familyName, fullName' },
        orgUnitPath: { type: 'string', description: 'Org unit the user belongs to' },
        suspended: { type: 'boolean', description: 'Whether the account is suspended' },
      },
    },
  },
}
