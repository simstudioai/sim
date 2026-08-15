import type {
  GoogleWorkspaceAdminGetRoleParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const getRoleTool: ToolConfig<
  GoogleWorkspaceAdminGetRoleParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_get_role',
  name: 'Google Workspace Admin Get Role',
  description: 'Read a single Google Workspace administrator role and its privileges',
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
    customer: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Customer ID, or "my_customer" for the authenticated account (default)',
    },
    roleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the role, as returned by List Roles',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customer || DEFAULT_CUSTOMER
      return `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/roles/${encodeURIComponent(params.roleId)}`
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to get role')
    return {
      success: true,
      output: { role: data },
    }
  },

  outputs: {
    role: {
      type: 'json',
      description: 'The Role resource',
      properties: {
        roleId: { type: 'string', description: 'Unique ID of the role' },
        roleName: { type: 'string', description: 'Name of the role' },
        roleDescription: { type: 'string', description: 'Description of the role' },
        rolePrivileges: {
          type: 'json',
          description: 'Privileges granted, each with serviceId and privilegeName',
        },
        isSystemRole: { type: 'boolean', description: 'Whether this is a built-in system role' },
        isSuperAdminRole: {
          type: 'boolean',
          description: 'Whether this is the super administrator role',
        },
      },
    },
  },
}
