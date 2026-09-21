import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2AddPermissionGroupMemberContract,
  v2BulkAddPermissionGroupMembersContract,
  v2CreatePermissionGroupContract,
  v2DeletePermissionGroupContract,
  v2GetPermissionGroupContract,
  v2ListPermissionGroupMembersContract,
  v2ListPermissionGroupsContract,
  v2ListPermissionGroupWorkspacesContract,
  v2RemovePermissionGroupMemberContract,
  v2UpdatePermissionGroupContract,
} from '@/lib/api/contracts/v2/permission-groups'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const TIMESTAMP = '2026-06-01T09:00:00.000Z'
const GROUP = {
  id: 'group-123',
  organizationId: 'org-123',
  name: 'Restricted',
  description: null,
  config: DEFAULT_PERMISSION_GROUP_CONFIG,
  isDefault: false,
  membershipMode: 'inherit',
  workspaceIds: ['workspace-123'],
  createdBy: 'admin-123',
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
}
const MEMBER = {
  id: 'assignment-123',
  userId: 'user-123',
  assignedAt: TIMESTAMP,
  userName: 'Example Member',
  userEmail: 'member@example.com',
  userImage: null,
}
const AUTHORITY = `Requires organization admin or owner access and active Access Control. ${WORKSPACE_API_KEY_DENIED}`

export const permissionGroupOpenApiRoutes = [
  defineOpenApiRoute(
    v2ListPermissionGroupsContract,
    {
      applicationOperation: permissionGroupOperations.list,
      operationId: 'listPermissionGroups',
      summary: 'List Permission Groups',
      description: `List permission groups in an organization with cursor pagination. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_ERRORS,
      success: { description: 'List Permission Groups result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2ListPermissionGroupsContract.params,
        'ListPermissionGroupsParams',
        'Organization parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2ListPermissionGroupsContract.query,
        'ListPermissionGroupsQuery',
        'Permission group list query',
        'Pagination and ordering controls.'
      ),
      response: documentedSchema(
        v2ListPermissionGroupsContract.response.schema,
        'ListPermissionGroupsResponse',
        'List Permission Groups response',
        'List Permission Groups result.',
        [{ data: [GROUP], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreatePermissionGroupContract,
    {
      applicationOperation: permissionGroupOperations.create,
      operationId: 'createPermissionGroup',
      summary: 'Create Permission Group',
      description: `Create a permission group. A non-default group requires workspaces and initially governs everyone in them. Creating a default group demotes the previous default to an inactive group until it is assigned workspaces. Overlapping all-member scopes conflict. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Create Permission Group result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2CreatePermissionGroupContract.params,
        'CreatePermissionGroupParams',
        'Organization parameters',
        'Organization identifier.'
      ),
      query: v2CreatePermissionGroupContract.query,
      body: documentedSchema(
        v2CreatePermissionGroupContract.body,
        'CreatePermissionGroupRequest',
        'Create Permission Group request',
        'Create Permission Group inputs.',
        [{ name: 'Restricted', workspaceIds: ['workspace-123'] }]
      ),
      response: documentedSchema(
        v2CreatePermissionGroupContract.response.schema,
        'CreatePermissionGroupResponse',
        'Create Permission Group response',
        'Create Permission Group result.',
        [{ data: GROUP }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetPermissionGroupContract,
    {
      applicationOperation: permissionGroupOperations.read,
      operationId: 'getPermissionGroup',
      summary: 'Get Permission Group',
      description: `Get a permission group and its resolved restrictions. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_ERRORS,
      success: { description: 'Get Permission Group result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2GetPermissionGroupContract.params,
        'GetPermissionGroupParams',
        'Permission group parameters',
        'Organization and permission-group identifiers.'
      ),
      query: v2GetPermissionGroupContract.query,
      response: documentedSchema(
        v2GetPermissionGroupContract.response.schema,
        'GetPermissionGroupResponse',
        'Get Permission Group response',
        'Get Permission Group result.',
        [{ data: GROUP }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdatePermissionGroupContract,
    {
      applicationOperation: permissionGroupOperations.update,
      operationId: 'updatePermissionGroup',
      summary: 'Update Permission Group',
      description: `Update a permission group. Omitted fields remain unchanged; config keys are patched and supplied arrays replace their lists. Promoting a group to default demotes the previous default; demoting without workspaceIds leaves it inactive. Overlapping member or all-member scopes conflict. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Update Permission Group result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2UpdatePermissionGroupContract.params,
        'UpdatePermissionGroupParams',
        'Permission group parameters',
        'Organization and permission-group identifiers.'
      ),
      query: v2UpdatePermissionGroupContract.query,
      body: documentedSchema(
        v2UpdatePermissionGroupContract.body,
        'UpdatePermissionGroupRequest',
        'Update Permission Group request',
        'Update Permission Group inputs.',
        [{ description: 'Restricted workspace access' }]
      ),
      response: documentedSchema(
        v2UpdatePermissionGroupContract.response.schema,
        'UpdatePermissionGroupResponse',
        'Update Permission Group response',
        'Update Permission Group result.',
        [{ data: GROUP }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeletePermissionGroupContract,
    {
      applicationOperation: permissionGroupOperations.delete,
      operationId: 'deletePermissionGroup',
      summary: 'Delete Permission Group',
      description: `Permanently delete a permission group and its membership assignments. Members then inherit any other applicable restrictions. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_ERRORS,
      success: { description: 'Delete Permission Group result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2DeletePermissionGroupContract.params,
        'DeletePermissionGroupParams',
        'Permission group parameters',
        'Organization and permission-group identifiers.'
      ),
      query: v2DeletePermissionGroupContract.query,
      response: documentedSchema(
        v2DeletePermissionGroupContract.response.schema,
        'DeletePermissionGroupResponse',
        'Delete Permission Group response',
        'Delete Permission Group result.',
        [{ data: { id: 'group-123', deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListPermissionGroupMembersContract,
    {
      applicationOperation: permissionGroupOperations.listMembers,
      operationId: 'listPermissionGroupMembers',
      summary: 'List Permission Group Members',
      description: `List explicit membership assignments in a permission group with cursor pagination. An empty inherit group applies to everyone in its workspaces. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'List Permission Group Members result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListPermissionGroupMembersContract.params,
        'ListPermissionGroupMembersParams',
        'Permission group parameters',
        'Organization and permission-group identifiers.'
      ),
      query: documentedSchema(
        v2ListPermissionGroupMembersContract.query,
        'ListPermissionGroupMembersQuery',
        'Permission group list query',
        'Pagination and ordering controls.'
      ),
      response: documentedSchema(
        v2ListPermissionGroupMembersContract.response.schema,
        'ListPermissionGroupMembersResponse',
        'List Permission Group Members response',
        'List Permission Group Members result.',
        [{ data: [MEMBER], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2AddPermissionGroupMemberContract,
    {
      applicationOperation: permissionGroupOperations.addMember,
      operationId: 'addPermissionGroupMember',
      summary: 'Add Permission Group Member',
      description: `Assign an organization member to a permission group. An existing assignment or membership in another group targeting the same workspace returns a conflict. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Add Permission Group Member result.', headers: RATE_LIMIT_HEADERS },
    },
    {
      params: documentedSchema(
        v2AddPermissionGroupMemberContract.params,
        'AddPermissionGroupMemberParams',
        'Permission group parameters',
        'Organization and permission-group identifiers.'
      ),
      query: v2AddPermissionGroupMemberContract.query,
      body: documentedSchema(
        v2AddPermissionGroupMemberContract.body,
        'AddPermissionGroupMemberRequest',
        'Add Permission Group Member request',
        'Add Permission Group Member inputs.',
        [{ userId: 'user-123' }]
      ),
      response: documentedSchema(
        v2AddPermissionGroupMemberContract.response.schema,
        'AddPermissionGroupMemberResponse',
        'Add Permission Group Member response',
        'Add Permission Group Member result.',
        [
          {
            data: {
              id: 'assignment-123',
              permissionGroupId: 'group-123',
              organizationId: 'org-123',
              userId: 'user-123',
              assignedBy: 'admin-123',
              assignedAt: TIMESTAMP,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2RemovePermissionGroupMemberContract,
    {
      applicationOperation: permissionGroupOperations.removeMember,
      operationId: 'removePermissionGroupMember',
      summary: 'Remove Permission Group Member',
      description: `Remove a membership assignment. Removing the last member from an inherit group makes it govern everyone in its workspaces; a conflicting all-member group prevents the removal. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Remove Permission Group Member result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2RemovePermissionGroupMemberContract.params,
        'RemovePermissionGroupMemberParams',
        'Permission group parameters',
        'Organization and permission-group identifiers.'
      ),
      query: v2RemovePermissionGroupMemberContract.query,
      response: documentedSchema(
        v2RemovePermissionGroupMemberContract.response.schema,
        'RemovePermissionGroupMemberResponse',
        'Remove Permission Group Member response',
        'Remove Permission Group Member result.',
        [{ data: { id: 'assignment-123', deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2BulkAddPermissionGroupMembersContract,
    {
      applicationOperation: permissionGroupOperations.bulkAddMembers,
      operationId: 'bulkAddPermissionGroupMembers',
      summary: 'Bulk Add Permission Group Members',
      description: `Assign up to 1000 selected organization members, or the entire organization roster, atomically. Existing assignments are skipped and users outside the organization are ignored. Any overlapping membership conflict rejects the entire batch. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Bulk Add Permission Group Members result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2BulkAddPermissionGroupMembersContract.params,
        'BulkAddPermissionGroupMembersParams',
        'Permission group parameters',
        'Organization and permission-group identifiers.'
      ),
      query: v2BulkAddPermissionGroupMembersContract.query,
      body: documentedSchema(
        v2BulkAddPermissionGroupMembersContract.body,
        'BulkAddPermissionGroupMembersRequest',
        'Bulk Add Permission Group Members request',
        'Bulk Add Permission Group Members inputs.',
        [{ userIds: ['user-123'] }]
      ),
      response: documentedSchema(
        v2BulkAddPermissionGroupMembersContract.response.schema,
        'BulkAddPermissionGroupMembersResponse',
        'Bulk Add Permission Group Members response',
        'Bulk Add Permission Group Members result.',
        [{ data: { added: 1, skipped: 0 } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListPermissionGroupWorkspacesContract,
    {
      applicationOperation: permissionGroupOperations.listWorkspaces,
      operationId: 'listPermissionGroupWorkspaces',
      summary: 'List Permission Group Workspaces',
      description: `List organization workspaces available for permission-group scope selection with cursor pagination. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'List Permission Group Workspaces result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListPermissionGroupWorkspacesContract.params,
        'ListPermissionGroupWorkspacesParams',
        'Organization parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2ListPermissionGroupWorkspacesContract.query,
        'ListPermissionGroupWorkspacesQuery',
        'Permission group list query',
        'Pagination and ordering controls.'
      ),
      response: documentedSchema(
        v2ListPermissionGroupWorkspacesContract.response.schema,
        'ListPermissionGroupWorkspacesResponse',
        'List Permission Group Workspaces response',
        'List Permission Group Workspaces result.',
        [{ data: [{ id: 'workspace-123', name: 'Engineering' }], nextCursor: null }]
      ),
    }
  ),
] as const
