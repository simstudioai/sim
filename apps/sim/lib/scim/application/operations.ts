import type { Principal, ScimCredentialScope } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'
import { assertOperationCapability } from '@/lib/core/application'

/**
 * The semantic operations of directory provisioning.
 *
 * SCIM has its own operation type rather than reusing `defineWorkspaceOperation`
 * for the same reason organization BYOK does: the caller has no workspace and no
 * role in one. Its authority is the credential the organization issued, and the
 * only policy left to declare is which credential scope each operation needs.
 */

export type ScimPrincipal = Extract<Principal, { kind: 'scim_connection' }>

export interface ScimOperation<Id extends string = string> extends ApplicationOperation<Id> {
  readonly authority: 'scim_connection'
  readonly principalKinds: readonly ['scim_connection']
  readonly scope: ScimCredentialScope
}

function defineScimOperation<const Id extends string>(
  operation: ScimOperation<Id>
): ScimOperation<Id> {
  assertOperationCapability(operation)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

export const scimOperations = {
  // permission-group-exempt: the caller is the organization's identity provider, not a member a permission group can govern
  listUsers: defineScimOperation({
    id: 'scim.users.list',
    capability: 'none',
    authority: 'scim_connection',
    principalKinds: ['scim_connection'],
    scope: 'users:read',
  }),
  // permission-group-exempt: the caller is the organization's identity provider, not a member a permission group can govern
  readUser: defineScimOperation({
    id: 'scim.users.read',
    capability: 'none',
    authority: 'scim_connection',
    principalKinds: ['scim_connection'],
    scope: 'users:read',
  }),
  // permission-group-exempt: the caller is the organization's identity provider, not a member a permission group can govern
  provisionUser: defineScimOperation({
    id: 'scim.users.provision',
    capability: 'none',
    authority: 'scim_connection',
    principalKinds: ['scim_connection'],
    scope: 'users:write',
  }),
  // permission-group-exempt: the caller is the organization's identity provider, not a member a permission group can govern
  updateUser: defineScimOperation({
    id: 'scim.users.update',
    capability: 'none',
    authority: 'scim_connection',
    principalKinds: ['scim_connection'],
    scope: 'users:write',
  }),
  // permission-group-exempt: the caller is the organization's identity provider, not a member a permission group can govern
  deprovisionUser: defineScimOperation({
    id: 'scim.users.deprovision',
    capability: 'none',
    authority: 'scim_connection',
    principalKinds: ['scim_connection'],
    scope: 'users:write',
  }),
  // permission-group-exempt: the caller is the organization's identity provider, not a member a permission group can govern
  listGroups: defineScimOperation({
    id: 'scim.groups.list',
    capability: 'none',
    authority: 'scim_connection',
    principalKinds: ['scim_connection'],
    scope: 'groups:read',
  }),
  // permission-group-exempt: the caller is the organization's identity provider, not a member a permission group can govern
  readGroup: defineScimOperation({
    id: 'scim.groups.read',
    capability: 'none',
    authority: 'scim_connection',
    principalKinds: ['scim_connection'],
    scope: 'groups:read',
  }),
  // permission-group-exempt: the caller is the organization's identity provider, not a member a permission group can govern
  writeGroup: defineScimOperation({
    id: 'scim.groups.write',
    capability: 'none',
    authority: 'scim_connection',
    principalKinds: ['scim_connection'],
    scope: 'groups:write',
  }),
  // permission-group-exempt: the caller is the organization's identity provider, not a member a permission group can govern
  deleteGroup: defineScimOperation({
    id: 'scim.groups.delete',
    capability: 'none',
    authority: 'scim_connection',
    principalKinds: ['scim_connection'],
    scope: 'groups:write',
  }),
} as const

/**
 * Administration of the connection itself, performed by a person in the Sim
 * settings UI rather than by the directory.
 *
 * Separate from the operations above because the authority is different in kind:
 * an organization owner or admin holding a session, gated on the enterprise
 * entitlement. Mirrors the organization BYOK operation shape.
 */
export interface ScimAdminOperation<Id extends string = string> extends ApplicationOperation<Id> {
  readonly authority: 'organization_admin'
  readonly organizationRoles: readonly ['admin', 'owner']
  readonly principalKinds: readonly ['session']
  readonly workspaceApiKey: 'deny'
}

export type ScimAdminPrincipal = Extract<Principal, { kind: 'session' }>

function defineScimAdminOperation<const Id extends string>(
  operation: ScimAdminOperation<Id>
): ScimAdminOperation<Id> {
  assertOperationCapability(operation)
  Object.freeze(operation.organizationRoles)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

const ADMIN_ROLES = ['admin', 'owner'] as const
const ADMIN_PRINCIPALS = ['session'] as const

/**
 * Each operation spells its policy out rather than spreading a shared literal.
 * `check:permission-group-enforcement` reads these declarations from source, and
 * a spread hides the capability from it — leaving the operation unaudited, which
 * is exactly the gap that check exists to catch.
 */
export const scimAdminOperations = {
  // permission-group-exempt: directory configuration is an owner/admin organization setting, like SSO provider registration
  read: defineScimAdminOperation({
    id: 'scim.connection.read',
    capability: 'none',
    authority: 'organization_admin',
    organizationRoles: ADMIN_ROLES,
    principalKinds: ADMIN_PRINCIPALS,
    workspaceApiKey: 'deny',
  }),
  // permission-group-exempt: directory configuration is an owner/admin organization setting, like SSO provider registration
  configure: defineScimAdminOperation({
    id: 'scim.connection.configure',
    capability: 'none',
    authority: 'organization_admin',
    organizationRoles: ADMIN_ROLES,
    principalKinds: ADMIN_PRINCIPALS,
    workspaceApiKey: 'deny',
  }),
  // permission-group-exempt: directory configuration is an owner/admin organization setting, like SSO provider registration
  issueCredential: defineScimAdminOperation({
    id: 'scim.credential.issue',
    capability: 'none',
    authority: 'organization_admin',
    organizationRoles: ADMIN_ROLES,
    principalKinds: ADMIN_PRINCIPALS,
    workspaceApiKey: 'deny',
  }),
  // permission-group-exempt: directory configuration is an owner/admin organization setting, like SSO provider registration
  revokeCredential: defineScimAdminOperation({
    id: 'scim.credential.revoke',
    capability: 'none',
    authority: 'organization_admin',
    organizationRoles: ADMIN_ROLES,
    principalKinds: ADMIN_PRINCIPALS,
    workspaceApiKey: 'deny',
  }),
  // permission-group-exempt: directory configuration is an owner/admin organization setting, like SSO provider registration
  upsertMapping: defineScimAdminOperation({
    id: 'scim.group_mapping.upsert',
    capability: 'none',
    authority: 'organization_admin',
    organizationRoles: ADMIN_ROLES,
    principalKinds: ADMIN_PRINCIPALS,
    workspaceApiKey: 'deny',
  }),
  // permission-group-exempt: directory configuration is an owner/admin organization setting, like SSO provider registration
  deleteMapping: defineScimAdminOperation({
    id: 'scim.group_mapping.delete',
    capability: 'none',
    authority: 'organization_admin',
    organizationRoles: ADMIN_ROLES,
    principalKinds: ADMIN_PRINCIPALS,
    workspaceApiKey: 'deny',
  }),
  // permission-group-exempt: directory configuration is an owner/admin organization setting, like SSO provider registration
  listActivity: defineScimAdminOperation({
    id: 'scim.activity.list',
    capability: 'none',
    authority: 'organization_admin',
    organizationRoles: ADMIN_ROLES,
    principalKinds: ADMIN_PRINCIPALS,
    workspaceApiKey: 'deny',
  }),
  // permission-group-exempt: directory configuration is an owner/admin organization setting, like SSO provider registration
  reconcile: defineScimAdminOperation({
    id: 'scim.connection.reconcile',
    capability: 'none',
    authority: 'organization_admin',
    organizationRoles: ADMIN_ROLES,
    principalKinds: ADMIN_PRINCIPALS,
    workspaceApiKey: 'deny',
  }),
} as const
