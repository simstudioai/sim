import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export type OrganizationByokPrincipal = Extract<
  Principal,
  { kind: 'session' | 'organization_delegated' }
>

export interface OrganizationByokOperation<Id extends string = string>
  extends ApplicationOperation<Id> {
  readonly authority: 'organization_admin'
  readonly organizationRoles: readonly ['admin', 'owner']
  readonly workspaceApiKey: 'deny'
  readonly principalKinds: readonly ('session' | 'organization_delegated')[]
  readonly minimumRole: 'admin'
  readonly delegationAudience?: string
  readonly delegatedServices?: readonly ['copilot']
  readonly entitlement: 'required' | 'cleanup_allowed'
}

function defineOrganizationByokOperation<const O extends OrganizationByokOperation>(
  operation: O
): O {
  Object.freeze(operation.organizationRoles)
  return defineOrganizationOperation(operation)
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
  /** permission-group-exempt: BYOK is a separate settings capability from Sim API-key management. */
  listWorkspace: defineWorkspaceOperation({
    id: 'byok_keys.workspace.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
  }),
  /** permission-group-exempt: admins must retain access to remove stored provider credentials. */
  deleteWorkspace: defineWorkspaceOperation({
    id: 'byok_keys.workspace.delete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
  }),
  // permission-group-exempt: BYOK is its own entitlement-gated section, and api_keys.manage names the Sim API Keys tab instead
  listOrganization: defineOrganizationByokOperation({
    id: 'byok_keys.organization.list',
    capability: 'none',
    authority: 'organization_admin',
    minimumRole: 'admin',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    entitlement: 'cleanup_allowed',
  }),
  // permission-group-exempt: BYOK is its own entitlement-gated section, and api_keys.manage names the Sim API Keys tab instead
  saveOrganization: defineOrganizationByokOperation({
    id: 'byok_keys.organization.save',
    capability: 'none',
    authority: 'organization_admin',
    minimumRole: 'admin',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
    entitlement: 'required',
  }),
  // permission-group-exempt: BYOK is its own entitlement-gated section, and api_keys.manage names the Sim API Keys tab instead
  deleteOrganization: defineOrganizationByokOperation({
    id: 'byok_keys.organization.delete',
    capability: 'none',
    authority: 'organization_admin',
    minimumRole: 'admin',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    entitlement: 'cleanup_allowed',
  }),
  // permission-group-exempt: BYOK is its own entitlement-gated section, and api_keys.manage names the Sim API Keys tab instead
  readInheritedStatus: defineWorkspaceOperation({
    id: 'byok_keys.inherited_status.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
  }),
} as const

export type ApiKeyOperation = (typeof apiKeyOperations)[keyof typeof apiKeyOperations]
export type ByokKeyOperation = (typeof byokKeyOperations)[keyof typeof byokKeyOperations]
