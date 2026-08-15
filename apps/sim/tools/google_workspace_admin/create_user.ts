import type {
  GoogleWorkspaceAdminCreateUserParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const createUserTool: ToolConfig<
  GoogleWorkspaceAdminCreateUserParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_create_user',
  name: 'Google Workspace Admin Create User',
  description: 'Create a new Google Workspace directory user account',
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
    primaryEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Primary email address for the new user (e.g. jane.doe@example.com)',
    },
    givenName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The user's first name",
    },
    familyName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "The user's last name",
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Initial password, 8-100 ASCII characters. Never returned by the API',
    },
    changePasswordAtNextLogin: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Force the user to change their password at first sign-in',
    },
    orgUnitPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full path of the org unit to place the user in (e.g. /Sales/West)',
    },
    suspended: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Create the account in a suspended state',
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
    url: () => `${DIRECTORY_API_BASE}/users`,
    method: 'POST',
    headers: adminHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {
        primaryEmail: params.primaryEmail,
        name: {
          givenName: params.givenName,
          familyName: params.familyName,
        },
        password: params.password,
      }

      if (params.changePasswordAtNextLogin !== undefined) {
        body.changePasswordAtNextLogin = params.changePasswordAtNextLogin
      }
      if (params.orgUnitPath) body.orgUnitPath = params.orgUnitPath
      if (params.suspended !== undefined) body.suspended = params.suspended
      if (params.recoveryEmail) body.recoveryEmail = params.recoveryEmail
      if (params.recoveryPhone) body.recoveryPhone = params.recoveryPhone

      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to create user')
    return {
      success: true,
      output: { user: data },
    }
  },

  outputs: {
    user: {
      type: 'json',
      description: 'The created Directory API User resource',
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
