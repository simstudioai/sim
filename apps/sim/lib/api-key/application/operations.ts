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
  /**
   * Not `api_keys.manage`: that capability hides the API Keys settings tab,
   * which holds Sim's own keys. BYOK is a separate, entitlement-gated section
   * for provider keys, and this read only reports which providers the
   * organization already supplies — no group key names it.
   */
  // permission-group-exempt: BYOK is its own entitlement-gated section, and api_keys.manage names the Sim API Keys tab instead
  readInheritedStatus: defineWorkspaceOperation({
    id: 'byok_keys.inherited_status.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
} as const

export type ApiKeyOperation = (typeof apiKeyOperations)[keyof typeof apiKeyOperations]
export type ByokKeyOperation = (typeof byokKeyOperations)[keyof typeof byokKeyOperations]
