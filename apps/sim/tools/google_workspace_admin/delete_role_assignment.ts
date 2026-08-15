import type {
  GoogleWorkspaceAdminDeleteRoleAssignmentParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  assertAdminSuccess,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteRoleAssignmentTool: ToolConfig<
  GoogleWorkspaceAdminDeleteRoleAssignmentParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_delete_role_assignment',
  name: 'Google Workspace Admin Delete Role Assignment',
  description:
    'Revoke a Google Workspace administrator role assignment, removing that admin access immediately',
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
    roleAssignmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Unique ID of the role assignment to revoke, as returned by List Role Assignments',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customer || DEFAULT_CUSTOMER
      return `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/roleassignments/${encodeURIComponent(params.roleAssignmentId)}`
    },
    method: 'DELETE',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    await assertAdminSuccess(response, 'Failed to delete role assignment')
    return {
      success: true,
      output: { message: 'Role assignment revoked successfully' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation that the role assignment was revoked' },
  },
}
