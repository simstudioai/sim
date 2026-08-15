import type {
  GoogleWorkspaceAdminListRoleAssignmentsParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  appendQueryParams,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

interface ListRoleAssignmentsApiResponse {
  items?: unknown[]
  nextPageToken?: string
}

export const listRoleAssignmentsTool: ToolConfig<
  GoogleWorkspaceAdminListRoleAssignmentsParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_list_role_assignments',
  name: 'Google Workspace Admin List Role Assignments',
  description: 'List which users and groups hold administrator roles in a Google Workspace account',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only assignments of this role ID',
    },
    userKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return only assignments for this user or group, given as a primary email address, alias email address, or unique ID',
    },
    includeIndirectRoleAssignments: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Also return roles inherited through group membership',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of assignments to return. Example: 100',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for fetching the next page of results',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customer || DEFAULT_CUSTOMER
      const url = new URL(
        `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/roleassignments`
      )
      appendQueryParams(url, {
        roleId: params.roleId,
        userKey: params.userKey,
        maxResults: params.maxResults,
        pageToken: params.pageToken,
      })
      if (params.includeIndirectRoleAssignments !== undefined) {
        url.searchParams.set(
          'includeIndirectRoleAssignments',
          String(params.includeIndirectRoleAssignments)
        )
      }
      return url.toString()
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<ListRoleAssignmentsApiResponse>(
      response,
      'Failed to list role assignments'
    )
    return {
      success: true,
      output: {
        roleAssignments: data.items ?? [],
        nextPageToken: data.nextPageToken ?? undefined,
      },
    }
  },

  outputs: {
    roleAssignments: {
      type: 'json',
      description: 'Array of RoleAssignment resources',
      items: {
        type: 'json',
        properties: {
          roleAssignmentId: { type: 'string', description: 'Unique ID of the assignment' },
          roleId: { type: 'string', description: 'ID of the assigned role' },
          assignedTo: {
            type: 'string',
            description: 'Unique ID of the user, group, or service account holding the role',
          },
          assigneeType: { type: 'string', description: 'Whether the assignee is a USER or GROUP' },
          scopeType: {
            type: 'string',
            description: 'Scope of the assignment: CUSTOMER or ORG_UNIT',
          },
          orgUnitId: {
            type: 'string',
            description: 'Org unit the assignment is scoped to, when scopeType is ORG_UNIT',
          },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
