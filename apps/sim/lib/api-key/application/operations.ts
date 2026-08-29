import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'
import { defineWorkspaceOperation } from '@/lib/core/application'

export type OrganizationByokPrincipal = Extract<Principal, { kind: 'session' }>

export interface OrganizationByokOperation<Id extends string = string>
  extends ApplicationOperation<Id> {
  readonly authority: 'organization_admin'
  readonly organizationRoles: readonly ['admin', 'owner']
  readonly workspaceApiKey: 'deny'
  readonly principalKinds: readonly ['session']
  readonly entitlement: 'required' | 'cleanup_allowed'
}

function defineOrganizationByokOperation<const Id extends string>(
  operation: OrganizationByokOperation<Id>
): OrganizationByokOperation<Id> {
  Object.freeze(operation.organizationRoles)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

export const apiKeyOperations = {
  createFromCopilot: defineWorkspaceOperation({
    id: 'api_keys.copilot.create',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'api_keys.manage',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
} as const

export const byokKeyOperations = {
  listOrganization: defineOrganizationByokOperation({
    id: 'byok_keys.organization.list',
    authority: 'organization_admin',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
    entitlement: 'cleanup_allowed',
  }),
  saveOrganization: defineOrganizationByokOperation({
    id: 'byok_keys.organization.save',
    authority: 'organization_admin',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
    entitlement: 'required',
  }),
  deleteOrganization: defineOrganizationByokOperation({
    id: 'byok_keys.organization.delete',
    authority: 'organization_admin',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
    entitlement: 'cleanup_allowed',
  }),
  readInheritedStatus: defineWorkspaceOperation({
    id: 'byok_keys.inherited_status.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const

export type ApiKeyOperation = (typeof apiKeyOperations)[keyof typeof apiKeyOperations]
export type ByokKeyOperation = (typeof byokKeyOperations)[keyof typeof byokKeyOperations]
