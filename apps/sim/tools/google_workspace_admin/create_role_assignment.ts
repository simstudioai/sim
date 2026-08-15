import type {
  GoogleWorkspaceAdminCreateRoleAssignmentParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const createRoleAssignmentTool: ToolConfig<
  GoogleWorkspaceAdminCreateRoleAssignmentParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_create_role_assignment',
  name: 'Google Workspace Admin Create Role Assignment',
  description:
    'Grant a Google Workspace administrator role to a user or group, either across the whole account or scoped to one org unit',
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
      description: 'Unique ID of the role to grant, as returned by List Roles',
    },
    assignedTo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Unique ID of the user, group, or service account receiving the role. This is the numeric directory ID, not an email address',
    },
    scopeType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Scope of the grant: CUSTOMER for the whole account, or ORG_UNIT to limit it to one org unit',
    },
    orgUnitId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique ID of the org unit to scope the grant to, when scopeType is ORG_UNIT',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customer || DEFAULT_CUSTOMER
      return `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/roleassignments`
    },
    method: 'POST',
    headers: adminHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {
        roleId: params.roleId,
        assignedTo: params.assignedTo,
      }
      if (params.scopeType) body.scopeType = params.scopeType
      if (params.orgUnitId) body.orgUnitId = params.orgUnitId
      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to create role assignment')
    return {
      success: true,
      output: { roleAssignment: data },
    }
  },

  outputs: {
    roleAssignment: {
      type: 'json',
      description: 'The created RoleAssignment resource',
      properties: {
        roleAssignmentId: { type: 'string', description: 'Unique ID of the assignment' },
        roleId: { type: 'string', description: 'ID of the assigned role' },
        assignedTo: { type: 'string', description: 'Unique ID of the assignee' },
        assigneeType: { type: 'string', description: 'Whether the assignee is a USER or GROUP' },
        scopeType: { type: 'string', description: 'Scope of the assignment: CUSTOMER or ORG_UNIT' },
        orgUnitId: {
          type: 'string',
          description: 'Org unit the assignment is scoped to, when scopeType is ORG_UNIT',
        },
      },
    },
  },
}
