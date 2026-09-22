import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

function definePermissionGroupOperation<const Id extends string>(
  id: Id,
  oauthScope: 'api:read' | 'api:write'
) {
  return defineOrganizationOperation({
    id,
    minimumRole: 'admin',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope,
    capability: 'none',
  })
}

export const permissionGroupOperations = {
  /**
   * permission-group-exempt: Organization admins manage Access Control itself; no group capability governs its configuration.
   */
  list: definePermissionGroupOperation('permission_groups.list', 'api:read'),
  /**
   * permission-group-exempt: Organization admins manage Access Control itself; no group capability governs its configuration.
   */
  read: definePermissionGroupOperation('permission_groups.read', 'api:read'),
  /**
   * permission-group-exempt: Organization admins manage Access Control itself; no group capability governs its configuration.
   */
  create: definePermissionGroupOperation('permission_groups.create', 'api:write'),
  /**
   * permission-group-exempt: Organization admins manage Access Control itself; no group capability governs its configuration.
   */
  update: definePermissionGroupOperation('permission_groups.update', 'api:write'),
  /**
   * permission-group-exempt: Organization admins manage Access Control itself; no group capability governs its configuration.
   */
  delete: definePermissionGroupOperation('permission_groups.delete', 'api:write'),
  /**
   * permission-group-exempt: Organization admins manage Access Control itself; no group capability governs its configuration.
   */
  listMembers: definePermissionGroupOperation('permission_groups.members.list', 'api:read'),
  /**
   * permission-group-exempt: Organization admins manage Access Control itself; no group capability governs its configuration.
   */
  addMember: definePermissionGroupOperation('permission_groups.members.add', 'api:write'),
  /**
   * permission-group-exempt: Organization admins manage Access Control itself; no group capability governs its configuration.
   */
  removeMember: definePermissionGroupOperation('permission_groups.members.remove', 'api:write'),
  /**
   * permission-group-exempt: Organization admins manage Access Control itself; no group capability governs its configuration.
   */
  bulkAddMembers: definePermissionGroupOperation('permission_groups.members.bulk_add', 'api:write'),
  /**
   * permission-group-exempt: Organization admins manage Access Control itself; no group capability governs its configuration.
   */
  listWorkspaces: definePermissionGroupOperation('permission_groups.workspaces.list', 'api:read'),
} as const

export const permissionGroupWorkspaceOperations = {
  /**
   * permission-group-exempt: Members must be able to read their own restrictions.
   */
  readUserConfig: defineWorkspaceOperation({
    id: 'permission_groups.read_user_config',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    oauthScope: 'api:read',
    capability: 'none',
  }),
} as const
