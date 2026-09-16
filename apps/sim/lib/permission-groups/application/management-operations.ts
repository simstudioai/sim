import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

const policy = {
  minimumRole: 'admin',
  principalKinds: ['session', 'organization_delegated'],
  delegationAudience: 'sim:settings',
  delegatedServices: ['copilot'],
  /** permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement. */
  capability: 'none',
} as const

export const permissionGroupManagementOperations = {
  // permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement.
  list: defineOrganizationOperation({
    ...policy,
    id: 'permission_groups.list',
    capability: 'none',
  }),
  // permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement.
  get: defineOrganizationOperation({ ...policy, id: 'permission_groups.get', capability: 'none' }),
  // permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement.
  create: defineOrganizationOperation({
    ...policy,
    id: 'permission_groups.create',
    capability: 'none',
  }),
  // permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement.
  update: defineOrganizationOperation({
    ...policy,
    id: 'permission_groups.update',
    capability: 'none',
  }),
  // permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement.
  delete: defineOrganizationOperation({
    ...policy,
    id: 'permission_groups.delete',
    capability: 'none',
  }),
  // permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement.
  listMembers: defineOrganizationOperation({
    ...policy,
    id: 'permission_groups.members.list',
    capability: 'none',
  }),
  // permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement.
  addMember: defineOrganizationOperation({
    ...policy,
    id: 'permission_groups.members.add',
    capability: 'none',
  }),
  // permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement.
  removeMember: defineOrganizationOperation({
    ...policy,
    id: 'permission_groups.members.remove',
    capability: 'none',
  }),
  // permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement.
  bulkAddMembers: defineOrganizationOperation({
    ...policy,
    id: 'permission_groups.members.bulk_add',
    capability: 'none',
  }),
  // permission-group-exempt: managing access control requires current organization admin authority and enterprise entitlement.
  listWorkspaces: defineOrganizationOperation({
    ...policy,
    id: 'permission_groups.workspaces.list',
    capability: 'none',
  }),
} as const

export type PermissionGroupManagementOperation =
  (typeof permissionGroupManagementOperations)[keyof typeof permissionGroupManagementOperations]
