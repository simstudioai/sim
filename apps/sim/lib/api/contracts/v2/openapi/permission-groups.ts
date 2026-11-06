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
const AUTHORITY = `Requires organization Admin or owner access and active Access Control. ${WORKSPACE_API_KEY_DENIED}`

export const permissionGroupOpenApiRoutes = [
  defineOpenApiRoute(
    v2ListPermissionGroupsContract,
    {
      applicationOperation: permissionGroupOperations.list,
      operationId: 'listPermissionGroups',
      summary: 'List permission groups',
      description: `List permission groups in an organization with cursor pagination. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'A page of permission groups with resolved settings.',
        headers: RATE_LIMIT_HEADERS,
      },
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
        'List permission groups response',
        'A page of permission groups with resolved settings.',
        [{ data: [GROUP], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreatePermissionGroupContract,
    {
      applicationOperation: permissionGroupOperations.create,
      operationId: 'createPermissionGroup',
      summary: 'Create permission group',
      description: `Create a permission group. A non-default group requires workspaces and initially governs everyone in them. Creating a default group demotes the previous default to an inactive group until it is assigned workspaces. Overlapping all-member scopes conflict. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The created group, its resolved settings, and workspace scope.',
        headers: RATE_LIMIT_HEADERS,
      },
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
        'Create permission group request',
        'Group name, initial restrictions, and default or workspace-specific scope.',
        [{ name: 'Restricted', workspaceIds: ['workspace-123'] }]
      ),
      response: documentedSchema(
        v2CreatePermissionGroupContract.response.schema,
        'CreatePermissionGroupResponse',
        'Create permission group response',
        'The created group, its resolved settings, and workspace scope.',
        [{ data: GROUP }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetPermissionGroupContract,
    {
      applicationOperation: permissionGroupOperations.read,
      operationId: 'getPermissionGroup',
      summary: 'Get permission group',
      description: `Get a permission group and its resolved settings. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'The group, its resolved settings, and workspace scope.',
        headers: RATE_LIMIT_HEADERS,
      },
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
        'Get permission group response',
        'The group, its resolved settings, and workspace scope.',
        [{ data: GROUP }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdatePermissionGroupContract,
    {
      applicationOperation: permissionGroupOperations.update,
      operationId: 'updatePermissionGroup',
      summary: 'Update permission group',
      description: `Update a permission group. Omitted fields remain unchanged; config keys are patched and supplied arrays replace their lists. Promoting a group to default demotes the previous default; demoting without workspaceIds leaves it inactive. Overlapping member or all-member scopes conflict. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The updated group with resolved settings and workspace scope.',
        headers: RATE_LIMIT_HEADERS,
      },
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
        'Update permission group request',
        'Group fields and restriction keys to change; supplied lists replace their contents.',
        [{ description: 'Restricted workspace access' }]
      ),
      response: documentedSchema(
        v2UpdatePermissionGroupContract.response.schema,
        'UpdatePermissionGroupResponse',
        'Update permission group response',
        'The updated group with resolved settings and workspace scope.',
        [{ data: GROUP }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeletePermissionGroupContract,
    {
      applicationOperation: permissionGroupOperations.delete,
      operationId: 'deletePermissionGroup',
      summary: 'Delete permission group',
      description: `Permanently delete a permission group and its membership assignments. Members then inherit any other applicable restrictions. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'Acknowledgement that the group and its assignments were deleted.',
        headers: RATE_LIMIT_HEADERS,
      },
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
        'Delete permission group response',
        'Acknowledgement that the group and its assignments were deleted.',
        [{ data: { id: 'group-123', deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListPermissionGroupMembersContract,
    {
      applicationOperation: permissionGroupOperations.listMembers,
      operationId: 'listPermissionGroupMembers',
      summary: 'List permission group members',
      description: `List explicit membership assignments in a permission group with cursor pagination. An empty inherit group applies to everyone in its workspaces. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'A page of explicit group membership assignments.',
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
        'List permission group members response',
        'A page of explicit group membership assignments.',
        [{ data: [MEMBER], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2AddPermissionGroupMemberContract,
    {
      applicationOperation: permissionGroupOperations.addMember,
      operationId: 'addPermissionGroupMember',
      summary: 'Add permission group member',
      description: `Assign an organization member to a permission group. An existing assignment or membership in another group targeting the same workspace returns a conflict. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The new explicit membership assignment.',
        headers: RATE_LIMIT_HEADERS,
      },
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
        'Add permission group member request',
        'The organization member to assign to this group.',
        [{ userId: 'user-123' }]
      ),
      response: documentedSchema(
        v2AddPermissionGroupMemberContract.response.schema,
        'AddPermissionGroupMemberResponse',
        'Add permission group member response',
        'The new explicit membership assignment.',
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
      summary: 'Remove permission group member',
      description: `Remove a member by user identifier. Removing the last member from an inherit group makes it govern everyone in its workspaces; a conflicting all-member group prevents the removal. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Acknowledgement that the explicit assignment was removed.',
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
        'Remove permission group member response',
        'Acknowledgement that the explicit assignment was removed.',
        [{ data: { userId: 'user-123', deleted: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2BulkAddPermissionGroupMembersContract,
    {
      applicationOperation: permissionGroupOperations.bulkAddMembers,
      operationId: 'bulkAddPermissionGroupMembers',
      summary: 'Bulk add permission group members',
      description: `Assign up to 1000 selected organization members, or the entire organization roster, atomically. Existing assignments are skipped and users outside the organization are ignored. Any overlapping membership conflict rejects the entire batch. ${AUTHORITY}`,
      tags: ['Permission Groups'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Counts of added members and existing assignments skipped.',
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
        'Bulk add permission group members request',
        'Selected organization members or the entire current organization roster.',
        [{ userIds: ['user-123'] }]
      ),
      response: documentedSchema(
        v2BulkAddPermissionGroupMembersContract.response.schema,
        'BulkAddPermissionGroupMembersResponse',
        'Bulk add permission group members response',
        'Counts of added members and existing assignments skipped.',
        [{ data: { added: 1, skipped: 0 } }]
      ),
    }
  ),
] as const
